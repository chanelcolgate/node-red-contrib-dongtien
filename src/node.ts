import { NodeAPI, Node, NodeDef, NodeMessage } from 'node-red';

/**
 * ============================================================================
 * caosu-pr-meter-config  (config node)
 * ----------------------------------------------------------------------------
 * Chứa bảng mapping "biến -> machineName / tagValue / fieldName / lat / long"
 * dùng để map từ JSON đầu vào thành InfluxDB Line Protocol
 * ============================================================================
 */

export interface MetricDefinition {
  key: string; // key chuỗi cần tìm trong JSON (ví dụ: 'mu_tap:b_run_mlm1' hoặc 'robot:counter')
  name?: string; // tên hiển thị (không bắt buộc)
  machineName?: string; // giá trị cho tag machine_name
  tagValue?: string; // giá trị tag mô tả biến (ví dụ mu_tap:b_run_mlm1)
  fieldName?: string; // tên field trong InfluxDB, mặc định 'value'
  lat?: number; // optional latitude
  long?: number; // optional longitude
}

export interface DerivedMetricDefinition {
  // không dùng trong phiên bản này nhưng giữ để tương thích
  key: string;
  name: string;
  unit: string;
  xKey: string;
  yKey: string;
  zKey: string;
}

export interface CaosuMeterConfigDef extends NodeDef {
  device: string;
  metrics: MetricDefinition[];
  derivedMetrics: DerivedMetricDefinition[];
}

export interface CaosuMeterConfigNode extends Node {
  device: string;
  metricsMap: Record<string, MetricDefinition>;
  derivedMetricsList: DerivedMetricDefinition[];
}

/**
 * ============================================================================
 * caosu-insert (node xử lý chính)
 * ----------------------------------------------------------------------------
 * Nhận dữ liệu thô, tra cứu bảng mapping từ config node đã chọn, xuất ra
 * InfluxDB Line Protocol.
 * ============================================================================
 */

export interface CaosuInsertNodeDef extends NodeDef {
  meterConfig: string;
  factory: string;
  system: string;
  sub_system: string;
  measurement: string;
  db: string;
  precision: string;
  latitude?: string; // optional node-level lat tag name or value
  longitude?: string;
}

interface CaosuInsertNode extends Node {
  factory: string;
  system: string;
  sub_system: string;
  measurement: string;
  db: string;
  precision: string;
  latitude?: string;
  longitude?: string;
}

type CaosuInputListener = (
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
    map[m.key] = {
      key: m.key,
      name: m.name && m.name.trim() ? m.name : m.key,
      machineName: m.machineName || '',
      tagValue: m.tagValue || m.key,
      fieldName: m.fieldName || 'value',
      lat: typeof m.lat === 'number' ? m.lat : undefined,
      long: typeof m.long === 'number' ? m.long : undefined,
    } as MetricDefinition;
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

/**
 * Tìm value trong object bất kỳ theo key exact match (duyệt đệ quy). Trả về
 * giá trị đầu tiên tìm thấy (undefined nếu không có).
 */
// function findKeyInObject(obj: unknown, targetKey: string): unknown {
//   if (obj === null || obj === undefined) return undefined;
//   if (typeof obj !== 'object') return undefined;
//   if (Array.isArray(obj)) {
//     for (const item of obj) {
//       const v = findKeyInObject(item, targetKey);
//       if (v !== undefined) return v;
//     }
//     return undefined;
//   }
//   // obj is plain object
//   for (const k in Object.keys(obj as Record<string, unknown>)) {
//     if (k === targetKey) return (obj as Record<string, unknown>)[k];
//     const v = findKeyInObject((obj as Record<string, unknown>)[k], targetKey);
//     if (v !== undefined) return v;
//   }
//   return undefined;
// }
function findKeyInObject(obj: unknown, targetKey: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return undefined;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      // Xử lý pattern { tag: "mu_tap:xxx", value: ... } dùng trong payload này
      if (
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).tag === targetKey
      ) {
        return (item as Record<string, unknown>).value;
      }
      const v = findKeyInObject(item, targetKey);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  const record = obj as Record<string, unknown>;
  for (const k of Object.keys(record)) {
    if (k === targetKey) return record[k];
    const v = findKeyInObject(record[k], targetKey);
    if (v !== undefined) return v;
  }
  return undefined;
}

module.exports = function (RED: NodeAPI) {
  // --------------------------------------------------------------------
  // Config node: caosu-pr-meter-config
  // --------------------------------------------------------------------
  function CaosuMeterConfigNode(
    this: CaosuMeterConfigNode,
    config: CaosuMeterConfigDef,
  ) {
    RED.nodes.createNode(this, config);
    this.device = config.device || '';
    this.metricsMap = buildMetricsMap(config.metrics);
    this.derivedMetricsList = buildDerivedList(config.derivedMetrics);
  }
  RED.nodes.registerType(
    'caosu-pr-meter-config',
    CaosuMeterConfigNode as never,
  );

  // --------------------------------------------------------------------
  // Node chính: caosu-pr-insert
  // --------------------------------------------------------------------
  function CaosuInsertNode(this: CaosuInsertNode, config: CaosuInsertNodeDef) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.factory = config.factory || '';
    node.system = config.system || '';
    node.sub_system = config.sub_system || '';
    node.measurement = config.measurement || 'caosu_measurement';
    node.db = config.db || 'caosu_phu_rieng';
    node.precision = config.precision || 'ns';
    node.latitude = config.latitude;
    node.longitude = config.longitude;

    const meterConfigNode = RED.nodes.getNode(
      config.meterConfig,
    ) as CaosuMeterConfigNode | null;

    if (!meterConfigNode) {
      node.warn(
        'Chưa chọn "Meter Config" (hoặc config đã bị xoá). Node sẽ không xuất ra dữ liệu nào.',
      );
      node.status({ fill: 'red', shape: 'ring', text: 'thiếu meter config' });
    } else if (Object.keys(meterConfigNode.metricsMap).length === 0) {
      node.warn(
        `Meter Config "${(meterConfigNode as any).name || meterConfigNode?.device}" chưa có biến nào (metrics rỗng).`,
      );
      node.status({ fill: 'yellow', shape: 'ring', text: 'metrics rỗng' });
    }

    const onInput: CaosuInputListener = function (msg, send, done) {
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

        const payload = msg.payload as unknown;
        if (!payload || typeof payload !== 'object') {
          node.status({
            fill: 'yellow',
            shape: 'ring',
            text: 'payload không hợp lệ',
          });
          return done();
        }

        // Try to find a timestamp in payload (ts) otherwise use now()
        let timestampRaw: number | undefined;
        // payload may be object with ts property or nested - try both
        if (typeof (payload as any).ts === 'number')
          timestampRaw = (payload as any).ts;
        else if (typeof (payload as any).ts === 'string')
          timestampRaw = Number((payload as any).ts);

        let timestamp = timestampRaw || Date.now();
        if (node.precision === 'ns') {
          timestamp = timestamp * 1000000;
        } else if (node.precision === 'us') {
          timestamp = timestamp * 1000;
        } else if (node.precision === 's') {
          timestamp = Math.floor(timestamp / 1000);
        }

        const lines: string[] = [];

        // For each configured metric, search payload for key and produce line
        for (const key of Object.keys(meterConfigNode.metricsMap)) {
          const metric = meterConfigNode.metricsMap[key];
          const rawValue = findKeyInObject(payload, metric.key);
          if (rawValue === undefined || rawValue === null) continue;

          // If it's an object with 'value' field, prefer that
          let val: unknown = rawValue;
          if (
            typeof rawValue === 'object' &&
            rawValue !== null &&
            'value' in (rawValue as any)
          ) {
            val = (rawValue as any).value;
          }

          const fieldValue = Number(val);
          if (Number.isNaN(fieldValue)) {
            // if not numeric, store as string field
            const tags = [
              `factory=${escapeString(node.factory)}`,
              `system=${escapeString(node.system)}`,
              `sub_system=${escapeString(node.sub_system)}`,
              `device=${escapeString(meterConfigNode.device)}`,
              `machine_name=${escapeString(metric.machineName || '')}`,
              `mapping_tag=${escapeString(metric.tagValue || metric.key)}`,
            ];
            if (metric.lat !== undefined)
              tags.push(`lat=${escapeString(metric.lat)}`);
            if (metric.long !== undefined)
              tags.push(`long=${escapeString(metric.long)}`);
            if (node.latitude)
              tags.push(`latitude=${escapeString(node.latitude)}`);
            if (node.longitude)
              tags.push(`longitude=${escapeString(node.longitude)}`);

            const fieldName = metric.fieldName || 'value';
            // For string field, value must be quoted
            lines.push(
              `${node.measurement},${tags.join(',')} ${fieldName}="${String(val).replace(/"/g, '\\"')}" ${timestamp}`,
            );
            continue;
          }

          const tags = [
            `factory=${escapeString(node.factory)}`,
            `system=${escapeString(node.system)}`,
            `sub_system=${escapeString(node.sub_system)}`,
            `device=${escapeString(meterConfigNode.device)}`,
            `machine_name=${escapeString(metric.machineName || '')}`,
            `mapping_tag=${escapeString(metric.tagValue || metric.key)}`,
          ];

          if (metric.lat !== undefined)
            tags.push(`lat=${escapeString(metric.lat)}`);
          if (metric.long !== undefined)
            tags.push(`long=${escapeString(metric.long)}`);
          if (node.latitude)
            tags.push(`latitude=${escapeString(node.latitude)}`);
          if (node.longitude)
            tags.push(`longitude=${escapeString(node.longitude)}`);

          const fieldName = metric.fieldName || 'value';
          lines.push(
            `${node.measurement},${tags.join(',')} ${fieldName}=${fieldValue} ${timestamp}`,
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

    (node.on as (event: string, listener: CaosuInputListener) => Node).call(
      node,
      'input',
      onInput,
    );

    node.on('close', function () {
      node.status({});
    });
  }

  RED.nodes.registerType('caosu-pr-insert', CaosuInsertNode as never);
};
