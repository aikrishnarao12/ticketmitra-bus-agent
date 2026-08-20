// Mock Indian city network + rough road distances (km).
// Not real-world accurate — this is a TEST/DEMO dataset only.

const CITIES = [
  { code: "HYD", name: "Hyderabad" },
  { code: "BLR", name: "Bengaluru" },
  { code: "MAA", name: "Chennai" },
  { code: "PNQ", name: "Pune" },
  { code: "BOM", name: "Mumbai" },
  { code: "DEL", name: "Delhi" },
  { code: "VGA", name: "Vijayawada" },
  { code: "VTZ", name: "Visakhapatnam" },
  { code: "CJB", name: "Coimbatore" },
  { code: "COK", name: "Kochi" },
];

// distances keyed "A|B" with A,B codes sorted alphabetically
const DISTANCES = {
  "BLR|HYD": 570, "HYD|MAA": 625, "HYD|PNQ": 560, "BOM|HYD": 710, "DEL|HYD": 1580,
  "HYD|VGA": 275, "HYD|VTZ": 620, "CJB|HYD": 880, "COK|HYD": 1100,
  "BLR|MAA": 350, "BLR|PNQ": 840, "BLR|BOM": 985, "BLR|DEL": 2150, "BLR|VGA": 480,
  "BLR|VTZ": 1000, "BLR|CJB": 365, "BLR|COK": 550,
  "MAA|PNQ": 1180, "BOM|MAA": 1330, "DEL|MAA": 2180, "MAA|VGA": 435, "MAA|VTZ": 800,
  "CJB|MAA": 500, "COK|MAA": 685,
  "BOM|PNQ": 150, "DEL|PNQ": 1450, "PNQ|VGA": 750, "PNQ|VTZ": 1150, "CJB|PNQ": 1180,
  "COK|PNQ": 1350,
  "BOM|DEL": 1400, "BOM|VGA": 900, "BOM|VTZ": 1300, "BOM|CJB": 1350, "BOM|COK": 1450,
  "DEL|VGA": 1600, "DEL|VTZ": 1700, "CJB|DEL": 2200, "COK|DEL": 2400,
  "VGA|VTZ": 350, "CJB|VGA": 850, "COK|VGA": 1050,
  "CJB|VTZ": 1200, "COK|VTZ": 1350,
  "CJB|COK": 190,
};

function findCity(query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
  return (
    CITIES.find((c) => c.code.toLowerCase() === q) ||
    CITIES.find((c) => c.name.toLowerCase() === q) ||
    CITIES.find((c) => c.name.toLowerCase().startsWith(q)) ||
    CITIES.find((c) => c.name.toLowerCase().includes(q)) ||
    null
  );
}

function distanceBetween(codeA, codeB) {
  if (codeA === codeB) return 0;
  const key = [codeA, codeB].sort().join("|");
  return DISTANCES[key] || null;
}

module.exports = { CITIES, findCity, distanceBetween };
