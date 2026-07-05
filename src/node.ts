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

export interface DongTienInsertNodeDef extends NodeDef {
  deviceType: string;
  factory: string;
  transformer: string;
  parentSystem: string;
  subSystem: string;
  device: string;
  measurement: string;
  db: string;
  precision: string;
  shiftVar: string;
  metrics: MetricDefinition[];
}

interface DongTienInsertNode extends Node {
  deviceType: string;
  factory: string;
  transformer: string;
  parentSystem: string;
  subSystem: string;
  device: string;
  measurement: string;
  db: string;
  precision: string;
  shiftVar: string;
  metricsMap: Record<string, MetricDefinition>;
}

function escapeString(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Unknown';
  return String(value)
    .replace(/\s/g, '\\ ')
    .replace(/,/g, '\\,')
    .replace(/=/g, '\\=');
}

module.exports = function (RED: NodeAPI) {
  function DongTienInsertNode(
    this: DongTienInsertNode,
    config: DongTienInsertNodeDef,
  ) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.deviceType = config.deviceType || 'custom';
    node.factory = config.factory || '';
    node.transformer = config.transformer || '';
    node.parentSystem = config.parentSystem || '';
    node.subSystem = config.subSystem || '';
    node.device = config.device || '';
    node.measurement = config.measurement || 'electric_measurement';
    node.db = config.db || 'dongtien';
    node.precision = config.precision || 'ns';
    node.shiftVar = config.shiftVar || 'shift';

    const rawMetrics: MetricDefinition[] = Array.isArray(config.metrics)
      ? config.metrics
      : [];

    node.metricsMap = {};
    for (const m of rawMetrics) {
      if (!m || !m.key) continue;
      const div = Number(m.div);
      node.metricsMap[m.key] = {
        key: m.key,
        name: m.name && m.name.trim() ? m.name : m.key,
        unit: m.unit || '',
        div: Number.isFinite(div) && div !== 0 ? div : 1,
      };
    }

    if (Object.keys(node.metricsMap).length === 0) {
      node.warn(
        'No metrics configured (metrics are empty). The node will not output any data.',
      );
    }

    const onInput: DongTienInputListener = function (msg, send, done) {
      send = send || ((m: NodeMessage) => node.send(m));
      done =
        done ||
        ((err?: Error | null) => {
          if (err) node.error(err, msg);
        });

      try {
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
            text: 'Unvalid payload',
          });
          return done();
        }

        const machineKey = Object.keys(rawPayload)[0];
        const dataNode = machineKey ? rawPayload[machineKey]?.[0] : undefined;

        if (!machineKey || !dataNode) {
          node.status({
            fill: 'yellow',
            shape: 'ring',
            text: "Don't have machine_key",
          });
          return done();
        }

        const timestamp = (dataNode.ts || Date.now()) * 1000000;
        const rawData = dataNode.values || {};

        const lines: string[] = [];

        for (const key of Object.keys(rawData)) {
          const metric = node.metricsMap[key];
          if (!metric) continue;

          const fieldValue = Number(rawData[key]) / metric.div;
          if (Number.isNaN(fieldValue)) continue;

          const tags = [
            `factory=${escapeString(node.factory)}`,
            `transformer=${escapeString(node.transformer)}`,
            `parent_system=${escapeString(node.parentSystem)}`,
            `sub_system=${escapeString(node.subSystem)}`,
            `machine=${escapeString(machineKey)}`,
            `device=${escapeString(node.device)}`,
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
            text: 'No variable matches the configuration.',
          });
          return done();
        }

        msg.payload = lines.join('\n');
        msg.db = node.db;
        msg.precision = node.precision;

        node.status({
          fill: 'green',
          shape: 'dot',
          text: `${lines.length} data point`,
        });

        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'processing error' });
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
