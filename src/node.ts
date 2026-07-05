import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';

/**
 * ============================================================================
 * dongtien-meter-config  (config node)
 * ----------------------------------------------------------------------------
 * Chứa bảng mapping "biến -> tên/đơn vị/độ chia" cho MỘT loại đồng hồ/cảm biến
 * (VD: iLEC MFM300, Arcel ACM 96L E4, CHINT PD7777, cảm biến rung...).
 * Được tạo 1 lần, dùng chung cho nhiều node "dongtien-insert" khác nhau (giống
 * cách 1 "S7 Endpoint" được nhiều node S7 dùng chung).
 * ============================================================================
 */

export interface MetricDefinition {
  key: string;
  name: string;
  unit: string;
  div: number;
}

export interface DongtienMeterConfigDef extends NodeDef {
  device: string;
  metrics: MetricDefinition[];
}

export interface DongtienMeterConfigNode extends Node {
  device: string;
  metricsMap: Record<string, MetricDefinition>;
}

/**
 * ============================================================================
 * dongtien-insert (node xử lý chính)
 * ----------------------------------------------------------------------------
 * Nhận dữ liệu thô, tra cứu bảng mapping từ config node đã chọn, xuất ra
 * InfluxDB Line Protocol.
 * ============================================================================
 */

export interface DongtienInsertNodeDef extends NodeDef {
  meterConfig: string;
  factory: string;
  transformer: string;
  parentSystem: string;
  subSystem: string;
  measurement: string;
  db: string;
  precision: string;
  shiftVar: string;
}

interface DongtienInsertNode extends Node {
  factory: string;
  transformer: string;
  parentSystem: string;
  subSystem: string;
  measurement: string;
  db: string;
  precision: string;
  shiftVar: string;
}

type DongtienInputListener = (
  msg: NodeMessage & { payload: unknown; db?: string; precision?: string },
  send: (msg: NodeMessage) => void,
  done: (err?: Error | null) => void,
) => void;

/** Escape ký tự đặc biệt cho InfluxDB Line Protocol. */
function escapeString(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Unknown';
  return String(value)
    .replace(/\s/g, '\\ ')
    .replace(/,/g, '\\,')
    .replace(/=/g, '\\=');
}

/** Chuẩn hoá danh sách metrics thô (từ editor) thành map tra cứu O(1). */
function buildMetricsMap(
  rawMetrics: MetricDefinition[] | undefined,
): Record<string, MetricDefinition> {
  const map: Record<string, MetricDefinition> = {};
  if (!Array.isArray(rawMetrics)) return map;
  for (const m of rawMetrics) {
    if (!m || !m.key) continue;
    const div = Number(m.div);
    map[m.key] = {
      key: m.key,
      name: m.name && m.name.trim() ? m.name : m.key,
      unit: m.unit || '',
      div: Number.isFinite(div) && div !== 0 ? div : 1,
    };
  }
  return map;
}

module.exports = function (RED: NodeAPI) {
  // --------------------------------------------------------------------
  // Config node: dongtien-meter-config
  // --------------------------------------------------------------------
  function DongtienMeterConfigNode(
    this: DongtienMeterConfigNode,
    config: DongtienMeterConfigDef,
  ) {
    RED.nodes.createNode(this, config);
    this.device = config.device || '';
    this.metricsMap = buildMetricsMap(config.metrics);
  }
  RED.nodes.registerType(
    'dongtien-meter-config',
    DongtienMeterConfigNode as never,
  );

  // --------------------------------------------------------------------
  // Node chính: dongtien-insert
  // --------------------------------------------------------------------
  function DongtienInsertNode(
    this: DongtienInsertNode,
    config: DongtienInsertNodeDef,
  ) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.factory = config.factory || '';
    node.transformer = config.transformer || '';
    node.parentSystem = config.parentSystem || '';
    node.subSystem = config.subSystem || '';
    node.measurement = config.measurement || 'electric_measurement';
    node.db = config.db || 'dongtien';
    node.precision = config.precision || 'ns';
    node.shiftVar = config.shiftVar || 'shift';

    const meterConfigNode = RED.nodes.getNode(
      config.meterConfig,
    ) as DongtienMeterConfigNode | null;

    if (!meterConfigNode) {
      node.warn(
        'Chưa chọn "Meter Config" (hoặc config đã bị xoá). Node sẽ không xuất ra dữ liệu nào.',
      );
      node.status({ fill: 'red', shape: 'ring', text: 'thiếu meter config' });
    } else if (Object.keys(meterConfigNode.metricsMap).length === 0) {
      node.warn(
        `Meter Config "${meterConfigNode.name || meterConfigNode.device}" chưa có biến nào (metrics rỗng).`,
      );
      node.status({ fill: 'yellow', shape: 'ring', text: 'metrics rỗng' });
    }

    const onInput: DongtienInputListener = function (msg, send, done) {
      send = send || ((m: NodeMessage) => node.send(m));
      done =
        done ||
        ((err?: Error | null) => {
          if (err) node.error(err, msg);
        });

      try {
        if (!meterConfigNode) {
          node.status({
            fill: 'red',
            shape: 'ring',
            text: 'thiếu meter config',
          });
          return done();
        }

        const shift =
          (node.context().global.get(node.shiftVar) as string) || 'Unassigned';

        const rawPayload = msg.payload as
          | Record<
              string,
              Array<{ ts?: number; values?: Record<string, unknown> }>
            >
          | undefined;

        if (!rawPayload || typeof rawPayload !== 'object') {
          node.status({
            fill: 'yellow',
            shape: 'ring',
            text: 'payload không hợp lệ',
          });
          return done();
        }

        const machineKey = Object.keys(rawPayload)[0];
        const dataNode = machineKey ? rawPayload[machineKey]?.[0] : undefined;

        if (!machineKey || !dataNode) {
          node.status({
            fill: 'yellow',
            shape: 'ring',
            text: 'không có machine_key',
          });
          return done();
        }

        const timestamp = (dataNode.ts || Date.now()) * 1000000;
        const rawData = dataNode.values || {};

        const lines: string[] = [];

        for (const key of Object.keys(rawData)) {
          const metric = meterConfigNode.metricsMap[key];
          if (!metric) continue;

          const fieldValue = Number(rawData[key]) / metric.div;
          if (Number.isNaN(fieldValue)) continue;

          const tags = [
            `factory=${escapeString(node.factory)}`,
            `transformer=${escapeString(node.transformer)}`,
            `parent_system=${escapeString(node.parentSystem)}`,
            `sub_system=${escapeString(node.subSystem)}`,
            `machine=${escapeString(machineKey)}`,
            `device=${escapeString(meterConfigNode.device)}`,
            `name=${escapeString(metric.name)}`,
            `unit=${escapeString(metric.unit)}`,
            `shift=${escapeString(shift)}`,
          ];

          lines.push(
            `${node.measurement},${tags.join(',')} value=${fieldValue} ${timestamp}`,
          );
        }

        if (lines.length === 0) {
          node.status({
            fill: 'yellow',
            shape: 'ring',
            text: 'không có biến nào khớp cấu hình',
          });
          return done();
        }

        msg.payload = lines.join('\n');
        msg.db = node.db;
        msg.precision = node.precision;

        node.status({
          fill: 'green',
          shape: 'dot',
          text: `${lines.length} điểm dữ liệu`,
        });

        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'lỗi xử lý' });
        done(err as Error);
      }
    };

    (node.on as (event: string, listener: DongtienInputListener) => Node).call(
      node,
      'input',
      onInput,
    );

    node.on('close', function () {
      node.status({});
    });
  }

  RED.nodes.registerType('dongtien-insert', DongtienInsertNode as never);
};
