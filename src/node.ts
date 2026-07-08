import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';

type DongTienInputListener = (
  msg: NodeMessage & { payload: unknown; db?: string; precision?: string },
  send: (msg: NodeMessage) => void,
  done: (err?: Error | null) => void,
) => void;

export interface MetricDefinition {
  key: string;
  name: string;
  unit: string;
  div: number;
}

export interface DerivedMetricDefinition {
  /** Key của field kết quả, dùng làm định danh nội bộ (không cần khớp raw_data) */
  key: string;
  /** Tên hiển thị -> tag "name" */
  name: string;
  /** Đơn vị -> tag "unit" (nên trùng đơn vị của X/Y/Z) */
  unit: string;
  /** key của biến X, Y, Z trong bảng mapping metrics (đã quy đổi) */
  xKey: string;
  yKey: string;
  zKey: string;
}

export interface DongTienMeterConfigDef extends NodeDef {
  device: string;
  metrics: MetricDefinition[];
  derivedMetrics: DerivedMetricDefinition[];
}

export interface DongTienMeterConfigNode extends Node {
  device: string;
  metricsMap: Record<string, MetricDefinition>;
  derivedMetricsList: DerivedMetricDefinition[];
}

export interface DongTienInsertNodeDef extends NodeDef {
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

interface DongTienInsertNode extends Node {
  factory: string;
  transformer: string;
  parentSystem: string;
  subSystem: string;

  measurement: string;
  db: string;
  precision: string;
  shiftVar: string;
}

function escapeString(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Unknown';
  return String(value)
    .replace(/\s/g, '\\ ')
    .replace(/,/g, '\\,')
    .replace(/=/g, '\\=');
}

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

function buildDerivedList(
  rawDerived: DerivedMetricDefinition[] | undefined,
): DerivedMetricDefinition[] {
  if (!Array.isArray(rawDerived)) return [];
  return rawDerived
    .filter((d) => d && d.key && d.xKey && d.yKey && d.zKey)
    .map((d) => ({
      key: d.key,
      name: d.name && d.name.trim() ? d.name : d.key,
      unit: d.unit || '',
      xKey: d.xKey,
      yKey: d.yKey,
      zKey: d.zKey,
    }));
}

module.exports = function (RED: NodeAPI) {
  function DongTienMeterConfigNode(
    this: DongTienMeterConfigNode,
    config: DongTienMeterConfigDef,
  ) {
    RED.nodes.createNode(this, config);
    this.device = config.device || '';
    this.metricsMap = buildMetricsMap(config.metrics);
    this.derivedMetricsList = buildDerivedList(config.derivedMetrics);
  }

  RED.nodes.registerType(
    'dongtien-meter-config',
    DongTienMeterConfigNode as never,
  );

  function DongTienInsertNode(
    this: DongTienInsertNode,
    config: DongTienInsertNodeDef,
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

    const meterConfigNode =
      (RED.nodes.getNode(config.meterConfig) as DongTienMeterConfigNode) ||
      null;

    if (!meterConfigNode) {
      node.warn(
        'Chưa chọn "Merter Config" (hoặc config đã bị xóa). Node sẽ không xuất ra dữ liệu nào.',
      );
      node.status({ fill: 'red', shape: 'ring', text: 'thiếu meter config' });
    } else if (Object.keys(meterConfigNode.metricsMap).length === 0) {
      node.warn(
        `Meter Config "${meterConfigNode.device}" chưa có biến nào {metrics rỗng}.`,
      );
      node.status({ fill: 'yellow', shape: 'ring', text: 'metrics rỗng' });
    }

    const onInput: DongTienInputListener = function (msg, send, done) {
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

        let timestamp = dataNode.ts || Date.now();
        if (node.precision === 'ns') {
          timestamp = timestamp * 1000000;
        } else if (node.precision === 'us') {
          timestamp = timestamp * 1000;
        } else if (node.precision === 's') {
          timestamp = Math.floor(timestamp / 1000);
        }

        const rawData = dataNode.values || {};

        const lines: string[] = [];
        const scaledValues: Record<string, number> = {};

        for (const key of Object.keys(rawData)) {
          const metric = meterConfigNode.metricsMap[key];
          if (!metric) continue;

          const fieldValue = Number(rawData[key]) / metric.div;
          if (Number.isNaN(fieldValue)) continue;

          scaledValues[key] = fieldValue;

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

        // Tính các "đại lượng tính toán" dạng vector magnitude:
        // D = sqrt(X^2 + Y^2 + Z^2), dựa trên giá trị đã quy đổi ở trên.
        // Bỏ qua nếu thiếu bất kỳ biến X/Y/Z nào trong lần đọc này.
        for (const derived of meterConfigNode.derivedMetricsList) {
          const x = scaledValues[derived.xKey];
          const y = scaledValues[derived.yKey];
          const z = scaledValues[derived.zKey];

          if (x === undefined || y === undefined || z === undefined) continue;

          const magnitude = Math.sqrt(x * x + y * y + z * z);
          if (Number.isNaN(magnitude)) continue;

          const tags = [
            `factory=${escapeString(node.factory)}`,
            `transformer=${escapeString(node.transformer)}`,
            `parent_system=${escapeString(node.parentSystem)}`,
            `sub_system=${escapeString(node.subSystem)}`,
            `machine=${escapeString(machineKey)}`,
            `device=${escapeString(meterConfigNode.device)}`,
            `name=${escapeString(derived.name)}`,
            `unit=${escapeString(derived.unit)}`,
            `shift=${escapeString(shift)}`,
          ];

          lines.push(
            `${node.measurement},${tags.join(',')} value=${magnitude} ${timestamp}`,
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

    (node.on as (event: string, listener: DongTienInputListener) => Node).call(
      node,
      'input',
      onInput,
    );

    node.on('close', function () {
      node.status({});
    });
  }

  RED.nodes.registerType('dongtien-insert', DongTienInsertNode as never);
};
