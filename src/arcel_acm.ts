/**
 * Escapes special characters for InfluxDB Line Protocol.
 */
function escape_string(string) {
  if (string === undefined || string === null) return 'Unknown';
  return string
    .toString()
    .replace(/\s/gi, '\\ ')
    .replace(/\,/g, '\\,')
    .replace(/\=/g, '\\=');
}

const shift = global.get('shift') || 'Unassigned';
const raw_payload = msg.payload;
const machine_key = Object.keys(raw_payload)[0];

if (!machine_key || !raw_payload[machine_key][0]) return null;

const data_node = raw_payload[machine_key][0];
const timestamp = (data_node.ts || Date.now()) * 1000000;
const raw_data = data_node.values || {};

// Định nghĩa metrics cho Arcel ACM 96L E4
const metrics_definition = {
  Ua: { name: 'Phase A Voltage', unit: 'V', div: 10 },
  Ub: { name: 'Phase B Voltage', unit: 'V', div: 10 },
  Uc: { name: 'Phase C Voltage', unit: 'V', div: 10 },
  Uab: { name: 'Line Voltage AB', unit: 'V', div: 10 },
  Ubc: { name: 'Line Voltage BC', unit: 'V', div: 10 },
  Uca: { name: 'Line Voltage CA', unit: 'V', div: 10 },
  Ia: { name: 'Phase A Current', unit: 'A', div: 1000 },
  Ib: { name: 'Phase B Current', unit: 'A', div: 1000 },
  Ic: { name: 'Phase C Current', unit: 'A', div: 1000 },
  Pa: { name: 'Phase A Active Power', unit: 'kW', div: 1000 },
  Pb: { name: 'Phase B Active Power', unit: 'kW', div: 1000 },
  Pc: { name: 'Phase C Active Power', unit: 'kW', div: 1000 },
  Pt: { name: 'Total Active Power', unit: 'kW', div: 1000 },
  Qa: { name: 'Phase A Reactive Power', unit: 'kVAR', div: 1000 },
  Qb: { name: 'Phase B Reactive Power', unit: 'kVAR', div: 1000 },
  Qc: { name: 'Phase C Reactive Power', unit: 'kVAR', div: 1000 },
  Qt: { name: 'Total Reactive Power', unit: 'kVAR', div: 1000 },
  Sa: { name: 'Phase A Apparent Power', unit: 'kVA', div: 1000 },
  Sb: { name: 'Phase B Apparent Power', unit: 'kVA', div: 1000 },
  Sc: { name: 'Phase C Apparent Power', unit: 'kVA', div: 1000 },
  St: { name: 'Total Apparent Power', unit: 'kVA', div: 1000 },
  PFa: { name: 'Phase A Power Factor', unit: 'None', div: 1000 },
  PFb: { name: 'Phase B Power Factor', unit: 'None', div: 1000 },
  PFc: { name: 'Phase C Power Factor', unit: 'None', div: 1000 },
  PFt: { name: 'Total Power Factor', unit: 'None', div: 1000 },
  Freq: { name: 'Frequency', unit: 'Hz', div: 100 },
  ImpEp: { name: 'Total Import Active Energy', unit: 'kWh', div: 1000 },
  ExpEp: { name: 'Total Export Active Energy', unit: 'kWh', div: 1000 },
};

const data = [];
const device_info = {
  factory: 'Dong Tien Paper Long An',
  transformer: '3000KVA',
  parent_system: 'MCC XEO',
  sub_system: 'Sang_Cuon',
  device: 'Arcel ACM 96L E4',
};

for (const key in raw_data) {
  if (metrics_definition.hasOwnProperty(key)) {
    const metric = metrics_definition[key];
    const field_value = Number(raw_data[key]) / metric.div;

    const tags = [
      `factory=${escape_string(device_info.factory)}`,
      `transformer=${escape_string(device_info.transformer)}`,
      `parent_system=${escape_string(device_info.parent_system)}`,
      `sub_system=${escape_string(device_info.sub_system)}`,
      `machine=${escape_string(machine_key)}`,
      `device=${escape_string(device_info.device)}`,
      `name=${escape_string(metric.name)}`,
      `unit=${escape_string(metric.unit)}`,
      `shift=${escape_string(shift)}`,
    ];

    data.push(
      `electric_measurement,${tags.join(',')} value=${field_value} ${timestamp}`,
    );
  }
}

msg.payload = data.join('\n');
msg.db = 'dongtien';
msg.precision = 'ns';
return msg;
