import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONSTANTS & DATA ──────────────────────────────────────────────────────────

const FARM_CONFIG = {
  name: "Woodlands Farm",
  location: "Kwekwe, Midlands Province",
  totalHectares: 119.2,
  coordinates: { lat: -18.9281, lng: 29.8149 },
};

const CROP_DATABASE = {
  kale: {
    name: "Kale (Covo)", family: "Brassica", daysToMaturity: [55, 75],
    yieldPerHa: { min: 15, max: 30, unit: "tonnes" },
    spacingCm: { row: 60, plant: 45 }, plantsPerHa: 37037, waterNeeds: "moderate",
    season: "Cool season (Apr-Sep best)",
    pests: ["Aphids", "Cabbage worms", "Flea beetles", "Diamondback moth", "Cutworms"],
    diseases: ["Black rot", "Downy mildew", "Alternaria leaf spot", "Clubroot"],
    companionPlants: ["Dill", "Mint", "Rosemary", "Onions", "Garlic"],
    notes: "Primary cash crop. Successive planting every 3 weeks for continuous harvest.",
  },
  maize: {
    name: "Maize", family: "Cereal", daysToMaturity: [105, 145],
    yieldPerHa: { min: 3, max: 8, unit: "tonnes" },
    spacingCm: { row: 90, plant: 25 }, plantsPerHa: 44444, waterNeeds: "high",
    season: "Rainy season (Nov-Mar)",
    pests: ["Fall armyworm", "Stalk borer", "Maize weevil", "Grasshoppers", "Cutworms"],
    diseases: ["Grey leaf spot", "Maize streak virus", "Northern leaf blight", "Ear rot"],
    companionPlants: ["Beans", "Squash", "Desmodium (push-pull)"],
    notes: "Staple crop. Plant at onset of rains. Consider push-pull for armyworm control.",
  },
  tomato: {
    name: "Tomato", family: "Solanaceae", daysToMaturity: [60, 85],
    yieldPerHa: { min: 20, max: 60, unit: "tonnes" },
    spacingCm: { row: 100, plant: 50 }, plantsPerHa: 20000, waterNeeds: "high",
    season: "Year-round with irrigation",
    pests: ["Whitefly", "Tomato leafminer (Tuta absoluta)", "Red spider mite", "Aphids"],
    diseases: ["Early blight", "Late blight", "Bacterial wilt", "Tomato mosaic virus"],
    companionPlants: ["Basil", "Marigolds", "Carrots"],
    notes: "High-value cash crop. Requires staking and consistent irrigation.",
  },
  onion: {
    name: "Onion", family: "Allium", daysToMaturity: [90, 150],
    yieldPerHa: { min: 20, max: 45, unit: "tonnes" },
    spacingCm: { row: 30, plant: 10 }, plantsPerHa: 333333, waterNeeds: "moderate",
    season: "Cool dry season (Mar-Aug)",
    pests: ["Thrips", "Onion fly", "Cutworms"],
    diseases: ["Purple blotch", "Downy mildew", "Fusarium basal rot"],
    companionPlants: ["Carrots", "Lettuce", "Beets"],
    notes: "Good storage crop. Stop irrigation 2 weeks before harvest.",
  },
  butternut: {
    name: "Butternut Squash", family: "Cucurbit", daysToMaturity: [85, 110],
    yieldPerHa: { min: 15, max: 35, unit: "tonnes" },
    spacingCm: { row: 200, plant: 100 }, plantsPerHa: 5000, waterNeeds: "moderate",
    season: "Warm season (Sep-Feb)",
    pests: ["Pumpkin fly", "Aphids", "Red spider mite", "Whitefly"],
    diseases: ["Powdery mildew", "Downy mildew", "Anthracnose"],
    companionPlants: ["Maize", "Beans", "Nasturtium"],
    notes: "Excellent market crop. Good shelf life for delayed sale.",
  },
  rape: {
    name: "Rape (Mustard greens)", family: "Brassica", daysToMaturity: [35, 50],
    yieldPerHa: { min: 10, max: 25, unit: "tonnes" },
    spacingCm: { row: 30, plant: 15 }, plantsPerHa: 222222, waterNeeds: "moderate",
    season: "Cool season (Apr-Sep)",
    pests: ["Aphids", "Diamondback moth", "Bagrada bug"],
    diseases: ["Black rot", "Alternaria", "Downy mildew"],
    companionPlants: ["Onions", "Garlic", "Dill"],
    notes: "Fast-growing leafy green. Very popular at Zimbabwean markets.",
  },
};

const PEST_TREATMENTS = {
  aphids: {
    organic: ["Neem oil spray (5ml/L water)", "Insecticidal soap", "Strong water jet", "Introduce ladybugs"],
    chemical: ["Imidacloprid", "Acetamiprid", "Dimethoate"],
    cultural: ["Remove affected leaves", "Companion plant with garlic/onions", "Encourage natural predators"],
  },
  "cabbage worms": {
    organic: ["Bacillus thuringiensis (Bt) spray", "Handpick caterpillars daily", "Floating row covers"],
    chemical: ["Cypermethrin", "Lambda-cyhalothrin"],
    cultural: ["Remove crop debris", "Rotate brassica crops (3-year cycle)", "Plant trap crops"],
  },
  "fall armyworm": {
    organic: ["Bt spray (early instar)", "Neem extract", "Push-pull system (Desmodium + Brachiaria)"],
    chemical: ["Emamectin benzoate", "Chlorantraniliprole", "Spinetoram"],
    cultural: ["Early planting", "Destroy crop residues", "Intercrop with legumes", "Scout every 3 days"],
  },
  "flea beetles": {
    organic: ["Diatomaceous earth", "Neem oil", "Floating row covers over seedlings"],
    chemical: ["Carbaryl", "Pyrethrin"],
    cultural: ["Delay planting until plants are vigorous", "Keep beds weed-free"],
  },
  diamondback: {
    organic: ["Bt spray", "Neem oil", "Parasitic wasps (Diadegma)"],
    chemical: ["Spinosad", "Indoxacarb"],
    cultural: ["Crop rotation", "Remove brassica weeds", "Intercrop with non-brassicas"],
  },
  whitefly: {
    organic: ["Yellow sticky traps", "Neem oil", "Insecticidal soap"],
    chemical: ["Imidacloprid", "Thiamethoxam"],
    cultural: ["Remove infested leaves", "Avoid over-fertilizing with nitrogen"],
  },
  cutworms: {
    organic: ["Cardboard collars around seedlings", "Bt spray", "Diatomaceous earth"],
    chemical: ["Chlorpyrifos bait", "Carbaryl"],
    cultural: ["Clear weeds before planting", "Till soil to expose larvae", "Night inspection with flashlight"],
  },
};

// ─── LIVESTOCK DATABASE ────────────────────────────────────────────────────────

const LIVESTOCK_DB = {
  chickens: {
    name: "Chickens", icon: "🐔", unit: "birds",
    breeds: [
      { name: "Black Australorp", purpose: "Layers", eggsPerYear: "250-300", matureWeight: "2.7-3.2 kg", notes: "Primary breed. Hardy, excellent layers, heat tolerant." },
      { name: "Hyline Brown", purpose: "Layers", eggsPerYear: "300-330", matureWeight: "1.8-2.0 kg", notes: "Commercial hybrid. Peak production at 26-30 weeks." },
      { name: "Boschveld", purpose: "Dual-purpose", eggsPerYear: "200-240", matureWeight: "2.5-3.0 kg", notes: "Indigenous cross. Disease resistant, free-range suited." },
      { name: "Sasso", purpose: "Broilers", eggsPerYear: "N/A", matureWeight: "2.5-3.5 kg at 12 weeks", notes: "Coloured broiler. Slower growth but hardier than Cobb/Ross." },
    ],
    vaccinations: [
      { disease: "Newcastle Disease", schedule: "Day 7, Day 21, Day 56, then every 3 months", vaccine: "I-2 thermostable (no cold chain)", critical: true },
      { disease: "Marek's Disease", schedule: "Day 1 (at hatchery)", vaccine: "HVT vaccine", critical: true },
      { disease: "Infectious Bronchitis", schedule: "Day 1, Day 14", vaccine: "IB H120", critical: false },
      { disease: "Fowl Pox", schedule: "Week 8-10, wing web", vaccine: "Fowl Pox vaccine", critical: false },
      { disease: "Gumboro (IBD)", schedule: "Day 14, Day 21", vaccine: "IBD intermediate", critical: true },
    ],
    commonDiseases: ["Newcastle Disease", "Coccidiosis", "Fowl Pox", "Marek's", "E. coli", "Chronic Respiratory Disease"],
    feedPerDay: "120-150g per layer",
    production: { type: "eggs", avgPerDay: "0.75-0.85 per bird (layers)", peakAge: "26-30 weeks" },
  },
  cattle: {
    name: "Cattle", icon: "🐄", unit: "head",
    breeds: [
      { name: "Brahman", purpose: "Beef", matureWeight: "500-800 kg", notes: "Heat/tick tolerant. Most popular beef breed in Zimbabwe." },
      { name: "Tuli", purpose: "Beef", matureWeight: "400-550 kg", notes: "Indigenous Zimbabwean breed. Excellent forager, fertile." },
      { name: "Mashona", purpose: "Dual-purpose", matureWeight: "350-450 kg", notes: "Indigenous. Small frame, very hardy, low maintenance." },
      { name: "Sussex x Brahman", purpose: "Beef cross", matureWeight: "500-650 kg", notes: "Popular cross. Good growth rate with heat tolerance." },
    ],
    vaccinations: [
      { disease: "Foot and Mouth (FMD)", schedule: "Every 6 months (Mar & Sep)", vaccine: "FMD polyvalent (SAT1/2/3)", critical: true },
      { disease: "Blackleg", schedule: "Annually before rainy season (Oct)", vaccine: "Clostridial vaccine", critical: true },
      { disease: "Anthrax", schedule: "Annually (Sep-Oct)", vaccine: "Anthrax spore vaccine", critical: true },
      { disease: "Lumpy Skin Disease", schedule: "Annually", vaccine: "LSD vaccine", critical: true },
      { disease: "Brucellosis", schedule: "Heifers at 3-8 months (once)", vaccine: "S19 or RB51", critical: false },
      { disease: "Botulism", schedule: "Annually", vaccine: "Botulinum toxoid", critical: false },
    ],
    commonDiseases: ["Theileriosis (January disease)", "Anaplasmosis (Gall-sickness)", "Babesiosis (Red-water)", "Heartwater", "FMD", "Lumpy Skin Disease"],
    feedPerDay: "10-12 kg DM (dry matter) per animal",
    production: { type: "weight gain", avgPerDay: "0.5-1.5 kg/day (feedlot)", weaningAge: "7-8 months" },
    dipping: "Every 7-14 days (tick control, critical in Midlands)",
  },
  goats: {
    name: "Goats", icon: "🐐", unit: "head",
    breeds: [
      { name: "Boer", purpose: "Meat", matureWeight: "80-120 kg (rams)", notes: "Premium meat breed. Fast growth, good carcass." },
      { name: "Mashona Goat", purpose: "Dual-purpose", matureWeight: "30-45 kg", notes: "Indigenous. Hardy, parasite resistant, browsers." },
      { name: "Kalahari Red", purpose: "Meat", matureWeight: "75-95 kg", notes: "Heat tolerant, good mothering ability." },
      { name: "Saanen x Local", purpose: "Dairy", matureWeight: "55-70 kg", notes: "Dairy cross. 2-3 litres/day with proper feeding." },
    ],
    vaccinations: [
      { disease: "Pulpy Kidney (Enterotoxaemia)", schedule: "Kids at 6-8 weeks, booster at 12 weeks, then annually", vaccine: "Multivax P Plus", critical: true },
      { disease: "Pasteurella", schedule: "Annually before cold season", vaccine: "Pasteurella vaccine", critical: false },
      { disease: "Orf (Contagious Ecthyma)", schedule: "Before kidding season", vaccine: "Orf vaccine", critical: false },
    ],
    commonDiseases: ["Internal parasites (Haemonchus)", "Heartwater", "Coccidiosis", "Pneumonia", "Orf", "Footrot"],
    feedPerDay: "3-5% of body weight (browse + supplement)",
    production: { type: "kids", avgKidsPerYear: "1.5-2.0", gestationDays: 150, weaningAge: "3-4 months" },
    deworming: "Every 3-4 months or by FAMACHA scoring",
  },
  pigs: {
    name: "Pigs", icon: "🐷", unit: "head",
    breeds: [
      { name: "Large White", purpose: "Bacon/Pork", matureWeight: "250-350 kg", notes: "Most common commercial breed in Zimbabwe." },
      { name: "Landrace", purpose: "Bacon", matureWeight: "250-320 kg", notes: "Good mothering, long body. Often crossed with Large White." },
      { name: "Duroc", purpose: "Pork", matureWeight: "250-340 kg", notes: "Good growth rate, marbled meat." },
      { name: "Mukota (Indigenous)", purpose: "Pork", matureWeight: "50-70 kg", notes: "Zimbabwean indigenous. Small, hardy, low input, high fat." },
    ],
    vaccinations: [
      { disease: "Erysipelas", schedule: "Gilts at 6 months, booster before farrowing, then annually", vaccine: "Erysipelas vaccine", critical: true },
      { disease: "Parvovirus", schedule: "Gilts before first mating", vaccine: "Parvo vaccine", critical: true },
      { disease: "E. coli scours", schedule: "Sows 5 and 2 weeks before farrowing", vaccine: "E. coli vaccine", critical: false },
    ],
    commonDiseases: ["African Swine Fever (ASF)", "Erysipelas", "Internal parasites", "Mange", "Pneumonia", "MMA (Mastitis)"],
    feedPerDay: "2-3 kg (growers), 2.5-3.5 kg (sows)",
    production: { type: "piglets", avgLitterSize: "8-12", gestationDays: 114, weaningAge: "4-6 weeks", marketWeight: "90-110 kg at 5-6 months" },
  },
  ostriches: {
    name: "Ostriches", icon: "🦅", unit: "birds",
    breeds: [
      { name: "Zimbabwe Blue", purpose: "Dual (skin + meat)", matureWeight: "100-160 kg", notes: "Local variety. Bluish neck colouring. Good skin quality." },
      { name: "African Black", purpose: "Feathers + skin", matureWeight: "90-130 kg", notes: "South African origin. Docile, good feather quality." },
      { name: "Red Neck", purpose: "Meat", matureWeight: "130-180 kg", notes: "Wild type. Aggressive, larger body. Needs experienced handlers." },
    ],
    vaccinations: [
      { disease: "Newcastle Disease", schedule: "Day 1, Day 14, then every 3 months", vaccine: "ND live + killed", critical: true },
      { disease: "Avian Influenza", schedule: "Monitoring only (no vaccine approved)", vaccine: "N/A (biosecurity)", critical: true },
    ],
    commonDiseases: ["Newcastle Disease", "Avian Influenza", "Impaction (crop/gizzard)", "Wire disease", "Leg problems", "Parasites"],
    feedPerDay: "1.5-2.5 kg (adults)",
    production: {
      type: "eggs + meat + skin + feathers",
      eggsPerSeason: "40-70 per hen (Aug-Mar)",
      eggWeight: "1.5-1.9 kg",
      slaughterAge: "12-14 months",
      skinValue: "Most valuable product ($150-300 per skin)",
      featherHarvest: "Every 6-8 months",
    },
    housing: "Large paddocks, 0.5 ha per breeding trio minimum. 1.8m+ fencing.",
  },
};

const SEED_HERDS = [
  { id: 1, type: "chickens", breed: "Black Australorp", count: 250, purpose: "Layers", location: "Poultry House A", status: "producing", acquired: "2026-01-15", notes: "Main laying flock. Peak production." },
  { id: 2, type: "chickens", breed: "Sasso", count: 100, purpose: "Broilers", location: "Poultry House B", status: "growing", acquired: "2026-05-01", notes: "Batch 3. Target weight 3kg at 12 weeks." },
  { id: 3, type: "cattle", breed: "Brahman", count: 18, purpose: "Beef", location: "Paddock 1", status: "grazing", acquired: "2025-06-01", notes: "Breeding herd. 1 bull, 15 cows, 2 heifers." },
  { id: 4, type: "cattle", breed: "Mashona", count: 12, purpose: "Dual-purpose", location: "Paddock 2", status: "grazing", acquired: "2024-11-01", notes: "Indigenous herd. Low maintenance." },
  { id: 5, type: "goats", breed: "Boer", count: 35, purpose: "Meat", location: "Goat Kraal", status: "breeding", acquired: "2025-09-01", notes: "3 bucks, 25 does, 7 kids." },
  { id: 6, type: "pigs", breed: "Large White", count: 8, purpose: "Pork", location: "Piggery", status: "growing", acquired: "2026-03-01", notes: "2 sows, 6 growers. Next farrowing expected July." },
];

const SEED_HEALTH_LOG = [
  { id: 1, date: "2026-06-01", herdId: 1, event: "vaccination", detail: "Newcastle Disease booster (I-2). All 250 birds.", cost: 25 },
  { id: 2, date: "2026-05-28", herdId: 3, event: "dipping", detail: "Routine tick dip. Amitraz 12.5%. All 18 head.", cost: 15 },
  { id: 3, date: "2026-05-20", herdId: 5, event: "deworming", detail: "Ivermectin drench. All goats including kids.", cost: 20 },
  { id: 4, date: "2026-05-15", herdId: 6, event: "treatment", detail: "Sow #1 treated for mastitis. Penicillin 3-day course.", cost: 12 },
  { id: 5, date: "2026-05-10", herdId: 1, event: "mortality", detail: "3 hens lost. Suspected coccidiosis. Treated flock with Amprolium.", cost: 8 },
];

const WEATHER_SEASONS_ZW = [
  { month: "Jan", temp: 26, rain: 170, season: "Hot Wet" },
  { month: "Feb", temp: 25, rain: 160, season: "Hot Wet" },
  { month: "Mar", temp: 25, rain: 100, season: "Hot Wet" },
  { month: "Apr", temp: 22, rain: 30, season: "Cool Dry" },
  { month: "May", temp: 19, rain: 5, season: "Cool Dry" },
  { month: "Jun", temp: 16, rain: 2, season: "Cool Dry" },
  { month: "Jul", temp: 16, rain: 1, season: "Cool Dry" },
  { month: "Aug", temp: 19, rain: 2, season: "Hot Dry" },
  { month: "Sep", temp: 23, rain: 10, season: "Hot Dry" },
  { month: "Oct", temp: 26, rain: 40, season: "Hot Wet" },
  { month: "Nov", temp: 26, rain: 100, season: "Hot Wet" },
  { month: "Dec", temp: 26, rain: 160, season: "Hot Wet" },
];

const FIELDS = [
  { id: 1, name: "Block A (Irrigated)", hectares: 12, crops: ["kale", "rape"], status: "active", soil: "Red clay loam" },
  { id: 2, name: "Block B (Irrigated)", hectares: 8, crops: ["tomato", "onion"], status: "active", soil: "Sandy loam" },
  { id: 3, name: "Block C (Dryland)", hectares: 35, crops: ["maize"], status: "planted", soil: "Red clay" },
  { id: 4, name: "Block D (Dryland)", hectares: 25, crops: ["maize", "butternut"], status: "planted", soil: "Red clay loam" },
  { id: 5, name: "Block E (Fallow)", hectares: 15, crops: [], status: "fallow", soil: "Sandy clay" },
  { id: 6, name: "Homestead Garden", hectares: 2, crops: ["kale", "tomato", "onion"], status: "active", soil: "Composted loam" },
  { id: 7, name: "Orchard Area", hectares: 5, crops: [], status: "planned", soil: "Deep red loam" },
  { id: 8, name: "Grazing / Reserve", hectares: 17.2, crops: [], status: "reserve", soil: "Mixed" },
];

// ─── VIDEO INTELLIGENCE: REFERENCE DATA ─────────────────────────────────────────
// Growth-stage vocabulary passed to Claude Vision so classification stays consistent
// across walks. Zero-shot per the v1.1 spec; refine with labelled refs later if it drifts.

const GROWTH_STAGE_REF = {
  maize: { label: "V-stage / R-stage", stages: ["VE (emergence)", "V2", "V4", "V6", "V8", "V10", "V12", "VT (tassel)", "R1 (silking)", "R3 (milk)", "R5 (dent)", "R6 (maturity)"] },
  kale: { label: "Leaf count / maturity", stages: ["Seedling", "2-leaf", "4-leaf", "6-leaf", "8-leaf", "Pre-harvest", "Harvest-ready", "Mature"] },
  rape: { label: "Leaf count / maturity", stages: ["Seedling", "2-leaf", "4-leaf", "6-leaf", "Harvest-ready"] },
  tomato: { label: "Phenological stage", stages: ["Seedling", "Vegetative", "Flowering", "Fruit set", "Green fruit", "Ripening", "Harvest"] },
  onion: { label: "Bulbing stage", stages: ["Seedling", "Leaf growth", "Bulb initiation", "Bulbing", "Maturity / topple"] },
  butternut: { label: "Phenological stage", stages: ["Seedling", "Vining", "Flowering", "Fruit set", "Maturing", "Harvest"] },
};

// Staggered planting batches give the comparative view its identity (spec section 3.5).
const SEED_BATCHES = [
  { id: "batch-kale-a", fieldId: 1, fieldName: "Block A (Irrigated)", crop: "kale", plantingDate: "2026-04-20", label: "Kale Batch A (Wk 16)", plantCount: 18500 },
  { id: "batch-kale-b", fieldId: 1, fieldName: "Block A (Irrigated)", crop: "kale", plantingDate: "2026-05-11", label: "Kale Batch B (Wk 19)", plantCount: 18500 },
  { id: "batch-kale-c", fieldId: 6, fieldName: "Homestead Garden", crop: "kale", plantingDate: "2026-05-25", label: "Kale Batch C (Wk 21)", plantCount: 4000 },
  { id: "batch-maize-c", fieldId: 3, fieldName: "Block C (Dryland)", crop: "maize", plantingDate: "2025-11-20", label: "Maize Block C", plantCount: 1555540 },
];

// Helper to build a seed frame set (placeholders until real frames are captured).
const seedFrames = (n = 5) => Array.from({ length: n }, (_, i) => ({ index: i, t: +(1 + i * 3).toFixed(1), src: null, placeholder: "growth" }));

const SEED_VIDEOS = [
  // ── Kale Batch A: three walks, healthy upward progression ──
  { id: "vid-a1", fieldId: 1, fieldName: "Block A (Irrigated)", batchId: "batch-kale-a", crop: "kale", source: "app_field_walk", capturedAt: "2026-05-04T07:40:00", durationSeconds: 22, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-05-04T07:45:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 0, growth_stage: "2-leaf", health_score: 70, health_flags: [], plant_density: "Even, ~6 plants/m2", weed_pressure: "low", pest_disease_signs: [], notes: "Uniform emergence across the bed." },
      { frameIndex: 2, growth_stage: "2-leaf", health_score: 73, health_flags: [{ type: "other", severity: "low", note: "Minor leaf nibble, monitor for flea beetle." }], plant_density: "Even", weed_pressure: "low", pest_disease_signs: [{ label: "Flea beetle (early)", confidence: "low", note: "A few shot-holes only." }], notes: "Strong stand, light pest pressure." },
      { frameIndex: 4, growth_stage: "2-leaf", health_score: 72, health_flags: [], plant_density: "Even", weed_pressure: "low", pest_disease_signs: [], notes: "Consistent vigour to row end." },
    ],
    aggregate: { growth_stage: "2-leaf", health_score: 72, flags: [{ type: "other", severity: "low", note: "Watch flea beetle." }], pests: [{ label: "Flea beetle (early)", confidence: "low" }], weedPressure: "low", notes: "Healthy uniform establishment, light early pest pressure." } },
  { id: "vid-a2", fieldId: 1, fieldName: "Block A (Irrigated)", batchId: "batch-kale-a", crop: "kale", source: "app_field_walk", capturedAt: "2026-05-18T07:30:00", durationSeconds: 26, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-05-18T07:35:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 1, growth_stage: "4-leaf", health_score: 81, health_flags: [], plant_density: "Dense canopy forming", weed_pressure: "low", pest_disease_signs: [], notes: "Good leaf expansion, deep green." },
      { frameIndex: 3, growth_stage: "4-leaf", health_score: 79, health_flags: [{ type: "nutrient_deficiency", severity: "low", note: "Slight paling on oldest leaves." }], plant_density: "Dense", weed_pressure: "low", pest_disease_signs: [], notes: "Top-dress N within the week." },
    ],
    aggregate: { growth_stage: "4-leaf", health_score: 80, flags: [{ type: "nutrient_deficiency", severity: "low", note: "Light N paling on old leaves." }], pests: [], weedPressure: "low", notes: "Vigorous canopy closing in. Minor N demand emerging." } },
  { id: "vid-a3", fieldId: 1, fieldName: "Block A (Irrigated)", batchId: "batch-kale-a", crop: "kale", source: "whatsapp", capturedAt: "2026-06-01T07:25:00", durationSeconds: 31, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-06-01T07:31:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 2, growth_stage: "6-leaf", health_score: 87, health_flags: [], plant_density: "Full canopy", weed_pressure: "none", pest_disease_signs: [], notes: "Excellent colour and turgor, near pre-harvest." },
      { frameIndex: 4, growth_stage: "6-leaf", health_score: 85, health_flags: [], plant_density: "Full canopy", weed_pressure: "none", pest_disease_signs: [{ label: "Aphid (trace)", confidence: "low", note: "Isolated cluster, one plant." }], notes: "Scout undersides next walk." },
    ],
    aggregate: { growth_stage: "6-leaf", health_score: 86, flags: [], pests: [{ label: "Aphid (trace)", confidence: "low" }], weedPressure: "none", notes: "Approaching harvest window in strong condition." } },

  // ── Kale Batch B: planted 3 weeks after A, trailing at matched age (underperforming) ──
  { id: "vid-b1", fieldId: 1, fieldName: "Block A (Irrigated)", batchId: "batch-kale-b", crop: "kale", source: "app_field_walk", capturedAt: "2026-05-25T08:10:00", durationSeconds: 24, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-05-25T08:14:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 1, growth_stage: "2-leaf", health_score: 62, health_flags: [{ type: "water_stress", severity: "moderate", note: "Leaf edges curling at midday." }], plant_density: "Patchy, gaps in rows 4-6", weed_pressure: "moderate", pest_disease_signs: [], notes: "Gappy stand, dry corner of bed." },
      { frameIndex: 3, growth_stage: "2-leaf", health_score: 66, health_flags: [{ type: "water_stress", severity: "low", note: "Wilting recovers by evening." }], plant_density: "Patchy", weed_pressure: "moderate", pest_disease_signs: [], notes: "Weeds competing in the gaps." },
    ],
    aggregate: { growth_stage: "2-leaf", health_score: 64, flags: [{ type: "water_stress", severity: "moderate", note: "Midday wilting, dry zone." }], pests: [], weedPressure: "moderate", notes: "Behind Batch A at the same age. Irrigation and weeding gap suspected." } },
  { id: "vid-b2", fieldId: 1, fieldName: "Block A (Irrigated)", batchId: "batch-kale-b", crop: "kale", source: "app_field_walk", capturedAt: "2026-06-01T08:05:00", durationSeconds: 28, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-06-01T08:10:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 2, growth_stage: "4-leaf", health_score: 71, health_flags: [{ type: "nutrient_deficiency", severity: "moderate", note: "General yellow-green cast." }], plant_density: "Improving but still gappy", weed_pressure: "low", pest_disease_signs: [], notes: "Recovered after irrigation fix; lagging colour." },
    ],
    aggregate: { growth_stage: "4-leaf", health_score: 70, flags: [{ type: "nutrient_deficiency", severity: "moderate", note: "Yellow-green, N short." }], pests: [], weedPressure: "low", notes: "Catching up after irrigation correction but still trails Batch A." } },

  // ── Maize Block C: late-season grain fill to maturity ──
  { id: "vid-m1", fieldId: 3, fieldName: "Block C (Dryland)", batchId: "batch-maize-c", crop: "maize", source: "app_field_walk", capturedAt: "2026-05-20T09:00:00", durationSeconds: 35, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-05-20T09:06:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 2, growth_stage: "R5 (dent)", health_score: 79, health_flags: [{ type: "other", severity: "low", note: "Lower-leaf senescence normal for stage." }], plant_density: "Full stand", weed_pressure: "low", pest_disease_signs: [], notes: "Cobs denting well, grain fill on track." },
    ],
    aggregate: { growth_stage: "R5 (dent)", health_score: 79, flags: [], pests: [], weedPressure: "low", notes: "Grain fill progressing normally toward maturity." } },
  { id: "vid-m2", fieldId: 3, fieldName: "Block C (Dryland)", batchId: "batch-maize-c", crop: "maize", source: "manual_upload", capturedAt: "2026-06-02T09:10:00", durationSeconds: 33, status: "analyzed", representativeFrameIndex: 2, createdAt: "2026-06-02T09:15:00",
    frames: seedFrames(5),
    analyses: [
      { frameIndex: 2, growth_stage: "R6 (maturity)", health_score: 82, health_flags: [], plant_density: "Full stand", weed_pressure: "low", pest_disease_signs: [], notes: "Black layer forming. Approaching harvest moisture." },
    ],
    aggregate: { growth_stage: "R6 (maturity)", health_score: 81, flags: [], pests: [], weedPressure: "low", notes: "Physiological maturity reached. Plan harvest at safe moisture." } },
];

// ─── SVG ICONS ─────────────────────────────────────────────────────────────────

const I = {
  Dashboard: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  Crop: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22V8"/><path d="M5 12H2a10 10 0 0020 0h-3"/><path d="M8 5.2C9.2 3.6 10.5 3 12 3s2.8.6 4 2.2"/></svg>,
  Bug: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3 3 0 116 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M17.47 9c1.93-.2 3.53-1.9 3.53-4M18 13h4M21 21c0-2.1-1.7-3.9-3.8-4"/></svg>,
  Yield: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg>,
  Walk: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="14" cy="5" r="2"/><path d="M18 17l-4-4-3 3-4-4"/><path d="M11 14l-1 6"/><path d="M14 13l2 6"/></svg>,
  Weather: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M17.66 17.66l1.41 1.41M18 12a6 6 0 11-12 0 6 6 0 0112 0z"/><path d="M2 12h2M6.34 17.66l-1.41 1.41M12 20v2M17.66 6.34l1.41-1.41"/></svg>,
  Tasks: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  WhatsApp: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
  Map: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Camera: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  Photo: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Gallery: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/></svg>,
  Menu: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  X: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Send: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Plus: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
  Leaf: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 20A7 7 0 019.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.5 4.5-6.3"/></svg>,
  Alert: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Drop: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>,
  Zap: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Trash: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
  Expand: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>,
  Clock: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  MapPin: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Upload: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>,
  Heart: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>,
  Livestock: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M9 8c0-1 .5-2 1.5-2.5M15 8c0-1-.5-2-1.5-2.5"/></svg>,
  Video: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
  Film: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>,
  Compare: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/><line x1="12" y1="2" x2="12" y2="22" strokeDasharray="2 2"/></svg>,
  Play: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
};

// ─── STYLES ────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,400&display=swap');
:root {
  --e9:#1a1209; --e8:#2d2011; --e7:#3d2e1a; --e6:#5c4428; --e5:#7a5c38;
  --e4:#a07c4f; --e3:#c4a46e; --e2:#dfc89e; --e1:#f0e4cc; --e0:#faf5eb;
  --g9:#0a2613; --g8:#133d20; --g7:#1a5c2e; --g6:#22753b; --g5:#2d9a4e;
  --g4:#45b868; --g3:#6fd48a; --g2:#a3e6b4; --g1:#d4f5dc; --g0:#ecfaef;
  --gold:#d4a843; --gold4:#e0be5f; --gold3:#ebd48a;
  --r5:#c0392b; --r4:#e74c3c; --r1:#fde8e5;
  --b5:#2980b9; --b1:#d6eaf8;
  --bg:#f7f3ed; --sf:#fff; --sa:#faf8f4; --tx:#1a1209; --ts:#5c4428; --tm:#9a8567;
  --bd:#e8dcc8; --bl:#f0e8d8;
  --fd:'Fraunces',Georgia,serif; --fb:'DM Sans',-apple-system,sans-serif;
  --rs:6px; --rm:10px; --rl:16px; --rx:24px;
  --ss:0 1px 3px rgba(26,18,9,.06); --sm:0 4px 12px rgba(26,18,9,.08); --sl:0 8px 30px rgba(26,18,9,.12);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--fb);background:var(--bg);color:var(--tx);line-height:1.6;-webkit-font-smoothing:antialiased}
.app{display:flex;min-height:100vh}

/* Sidebar */
.sb{width:260px;background:var(--e9);color:#fff;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100;transition:transform .3s}
.sb-h{padding:24px 20px;border-bottom:1px solid rgba(255,255,255,.08)}
.sb-logo{font-family:var(--fd);font-size:22px;font-weight:700;color:var(--gold4);display:flex;align-items:center;gap:10px}
.sb-icon{width:36px;height:36px;background:var(--g6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
.sb-sub{margin-top:8px;font-size:12px;color:rgba(255,255,255,.5);letter-spacing:.5px;text-transform:uppercase}
.sb-nav{flex:1;padding:12px 10px;overflow-y:auto}
.ns-t{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.3);padding:12px 12px 6px;font-weight:600}
.ni{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--rm);cursor:pointer;font-size:14px;color:rgba(255,255,255,.65);transition:all .2s;border:none;background:none;width:100%;text-align:left;font-family:var(--fb)}
.ni:hover{background:rgba(255,255,255,.06);color:rgba(255,255,255,.9)}
.ni.act{background:var(--g7);color:#fff;font-weight:500}
.ni .bdg{margin-left:auto;background:var(--r4);color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600}
.sb-f{padding:16px 20px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,255,255,.3)}

/* Main */
.mn{flex:1;margin-left:260px;min-height:100vh}
.tb{position:sticky;top:0;background:rgba(247,243,237,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--bd);padding:16px 32px;display:flex;align-items:center;justify-content:space-between;z-index:50}
.tb-t{font-family:var(--fd);font-size:22px;font-weight:600;color:var(--e8)}
.tb-s{font-size:13px;color:var(--tm);margin-top:2px}
.mmb{display:none;background:none;border:none;color:var(--e7);cursor:pointer;padding:8px}
.ct{padding:28px 32px;max-width:1200px}

/* Cards */
.cd{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:24px;box-shadow:var(--ss)}
.cd-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px}
.cd-t{font-family:var(--fd);font-size:17px;font-weight:600;color:var(--e8)}

/* Stats */
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.sc{background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);padding:20px;position:relative;overflow:hidden}
.sc::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.sc.grn::before{background:var(--g5)} .sc.gld::before{background:var(--gold)} .sc.blu::before{background:var(--b5)} .sc.ear::before{background:var(--e5)}
.sl{font-size:12px;color:var(--tm);text-transform:uppercase;letter-spacing:.8px;font-weight:500;margin-bottom:8px}
.sv{font-family:var(--fd);font-size:28px;font-weight:700;color:var(--e8)}
.ss{font-size:12px;color:var(--ts);margin-top:4px}

/* Grids */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}

/* Table */
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--tm);border-bottom:2px solid var(--bd);font-weight:600}
td{padding:12px 14px;font-size:14px;border-bottom:1px solid var(--bl);color:var(--tx)}
tr:hover td{background:var(--sa)}

/* Tags */
.tg{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.tg-g{background:var(--g1);color:var(--g7)} .tg-y{background:#fef3c7;color:#92400e} .tg-r{background:var(--r1);color:var(--r5)} .tg-b{background:var(--b1);color:var(--b5)} .tg-x{background:#f0ede8;color:var(--tm)}

/* Buttons */
.bt{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:var(--rm);font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all .2s;font-family:var(--fb)}
.bp{background:var(--g6);color:#fff} .bp:hover{background:var(--g7);transform:translateY(-1px);box-shadow:var(--sm)}
.bs{background:var(--sf);color:var(--tx);border:1px solid var(--bd)} .bs:hover{background:var(--sa)}
.bg{background:var(--gold);color:var(--e9)}
.bd{background:var(--r4);color:#fff}
.bsm{padding:6px 14px;font-size:12px}

/* Forms */
.inp,.sel,.ta{width:100%;padding:10px 14px;border:1px solid var(--bd);border-radius:var(--rm);font-size:14px;font-family:var(--fb);background:var(--sf);color:var(--tx);transition:border-color .2s}
.inp:focus,.sel:focus,.ta:focus{outline:none;border-color:var(--g5);box-shadow:0 0 0 3px rgba(45,154,78,.1)}
.ta{min-height:100px;resize:vertical}
.lb{display:block;font-size:13px;font-weight:500;color:var(--ts);margin-bottom:6px}
.fg{margin-bottom:16px}
.fr{display:grid;grid-template-columns:1fr 1fr;gap:16px}

/* ─── CAMERA & MEDIA STYLES ─────────────────────────────── */
.cam-strip{display:flex;gap:8px;overflow-x:auto;padding:4px 0;scrollbar-width:thin}
.cam-strip::-webkit-scrollbar{height:4px}
.cam-strip::-webkit-scrollbar-thumb{background:var(--bd);border-radius:4px}

.cam-thumb{width:72px;height:72px;border-radius:var(--rs);object-fit:cover;border:2px solid var(--bd);flex-shrink:0;cursor:pointer;transition:all .2s}
.cam-thumb:hover{border-color:var(--g5);transform:scale(1.05)}
.cam-thumb.sel{border-color:var(--g5);box-shadow:0 0 0 2px var(--g2)}

.cam-add{width:72px;height:72px;border-radius:var(--rs);border:2px dashed var(--bd);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all .2s;background:var(--sa);color:var(--tm)}
.cam-add:hover{border-color:var(--g4);color:var(--g5);background:var(--g0)}

.cam-cap-btn{display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--rm);font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .2s;font-family:var(--fb)}
.cam-live{background:var(--g6);color:#fff}
.cam-live:hover{background:var(--g7)}
.cam-file{background:var(--sf);color:var(--ts);border:1px solid var(--bd)}
.cam-file:hover{background:var(--sa)}

.cam-preview{position:relative;border-radius:var(--rl);overflow:hidden;background:#000;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center}
.cam-preview video{width:100%;height:100%;object-fit:cover}
.cam-preview img{max-width:100%;max-height:100%;object-fit:contain}

.cam-controls{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:10}
.cam-shutter{width:60px;height:60px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,.3);cursor:pointer;transition:all .15s;backdrop-filter:blur(4px)}
.cam-shutter:hover{background:rgba(255,255,255,.5);transform:scale(1.08)}
.cam-shutter:active{transform:scale(.95);background:#fff}
.cam-stop{width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(220,50,50,.7);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;backdrop-filter:blur(4px)}

.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.media-card{position:relative;border-radius:var(--rm);overflow:hidden;cursor:pointer;aspect-ratio:1;background:var(--sa);border:1px solid var(--bd);transition:all .2s}
.media-card:hover{transform:translateY(-2px);box-shadow:var(--sm);border-color:var(--g4)}
.media-card img{width:100%;height:100%;object-fit:cover}
.media-card-info{position:absolute;bottom:0;left:0;right:0;padding:8px 10px;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff}
.media-card-info .mf{font-size:11px;font-weight:600}
.media-card-info .md{font-size:10px;opacity:.8;margin-top:2px}
.media-card .mtag{position:absolute;top:8px;right:8px}

/* Lightbox */
.lbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn .2s}
.lbox img{max-width:90%;max-height:70vh;object-fit:contain;border-radius:var(--rm)}
.lbox-close{position:absolute;top:16px;right:16px;background:rgba(255,255,255,.15);border:none;color:#fff;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s}
.lbox-close:hover{background:rgba(255,255,255,.3)}
.lbox-info{color:#fff;margin-top:16px;text-align:center;max-width:600px}
.lbox-info h4{font-family:var(--fd);font-size:18px;margin-bottom:6px}
.lbox-info p{font-size:13px;opacity:.75;line-height:1.5}
.lbox-actions{display:flex;gap:10px;margin-top:14px;justify-content:center}

/* Snap Identify FAB */
.fab{position:fixed;bottom:28px;right:28px;z-index:90;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.fab-btn{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:var(--sl);transition:all .2s}
.fab-main{background:var(--g6);color:#fff;width:64px;height:64px}
.fab-main:hover{background:var(--g7);transform:scale(1.08)}
.fab-sec{background:var(--sf);color:var(--g6);width:48px;height:48px}
.fab-sec:hover{background:var(--g0)}
.fab-label{position:absolute;right:72px;white-space:nowrap;background:var(--e9);color:#fff;padding:6px 12px;border-radius:var(--rs);font-size:12px;font-weight:500;pointer-events:none;opacity:0;transition:opacity .15s}
.fab-sec:hover .fab-label{opacity:1}

/* Pest upload */
.puz{border:2px dashed var(--bd);border-radius:var(--rl);padding:32px;text-align:center;cursor:pointer;transition:all .2s;background:var(--sa)}
.puz:hover{border-color:var(--g4);background:var(--g0)}
.puz.has{padding:12px;border-style:solid;border-color:var(--g5)}
.puz img{max-width:100%;max-height:280px;border-radius:var(--rm);object-fit:contain}

/* Analysis result */
.ar{background:var(--g0);border:1px solid var(--g2);border-radius:var(--rl);padding:24px;margin-top:20px}
.ar h3{font-family:var(--fd);font-size:18px;color:var(--g8);margin-bottom:16px}
.ts-h{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--ts);margin-bottom:8px}
.ti{display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:14px}
.ti svg{flex-shrink:0;margin-top:3px;color:var(--g5)}

/* Yield */
.yr{background:linear-gradient(135deg,var(--g7) 0%,var(--e7) 100%);color:#fff;border-radius:var(--rl);padding:28px;margin-top:20px}
.yn{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.ynv{font-family:var(--fd);font-size:32px;font-weight:700;text-align:center}
.ynl{font-size:12px;opacity:.7;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;text-align:center}

/* Weather */
.wg{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.wm{text-align:center;padding:12px 8px;border-radius:var(--rm);background:var(--sa);border:1px solid var(--bl)}
.wm.cur{background:var(--g0);border-color:var(--g3)}

/* Tasks */
.tki{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bl)}
.tkc{width:20px;height:20px;border:2px solid var(--bd);border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s}
.tkc.chk{background:var(--g5);border-color:var(--g5)}
.tkp{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase}

/* Field Walk obs */
.obc{border:1px solid var(--bd);border-radius:var(--rm);padding:16px;margin-bottom:12px;background:var(--sf)}

/* WhatsApp */
.wac{background:#e5ddd5;border-radius:var(--rl);padding:20px;max-height:400px;overflow-y:auto}
.wam{max-width:80%;padding:8px 14px;border-radius:12px;margin-bottom:8px;font-size:14px;line-height:1.4;position:relative}
.wam.rcv{background:#fff;border-top-left-radius:0;margin-right:auto}
.wam.snt{background:#dcf8c6;border-top-right-radius:0;margin-left:auto}
.wat{font-size:10px;color:#999;text-align:right;margin-top:4px}

/* Map */
.fmg{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:8px;aspect-ratio:4/3}
.mb{border-radius:var(--rm);padding:12px;display:flex;flex-direction:column;justify-content:space-between;font-size:12px;cursor:pointer;transition:all .2s;border:2px solid transparent}
.mb:hover{transform:scale(1.02);box-shadow:var(--sm)}
.mb.active{background:var(--g1);border-color:var(--g4)}
.mb.planted{background:#fef9c3;border-color:#fbbf24}
.mb.fallow{background:var(--e1);border-color:var(--e3)}
.mb.planned{background:var(--b1);border-color:#93c5fd}
.mb.reserve{background:#f0ede8;border-color:#d6cfc2}

.spin{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}

/* ─── VIDEO INTELLIGENCE STYLES ─────────────────────────── */
.seg{display:inline-flex;background:var(--sa);border:1px solid var(--bd);border-radius:var(--rm);padding:3px;gap:3px}
.seg button{border:none;background:none;font-family:var(--fb);font-size:13px;font-weight:600;padding:7px 16px;border-radius:7px;cursor:pointer;color:var(--ts);display:flex;align-items:center;gap:6px;transition:all .15s}
.seg button.on{background:var(--g6);color:#fff;box-shadow:var(--ss)}

.rec-dot{width:11px;height:11px;border-radius:50%;background:var(--r4);animation:pulse 1.1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.rec-badge{position:absolute;top:14px;left:14px;display:flex;align-items:center;gap:7px;background:rgba(0,0,0,.55);color:#fff;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;z-index:10;backdrop-filter:blur(4px)}

.tl-strip{display:flex;gap:14px;overflow-x:auto;padding:6px 2px 14px}
.tl-strip::-webkit-scrollbar{height:6px}
.tl-strip::-webkit-scrollbar-thumb{background:var(--bd);border-radius:6px}
.tl-card{flex-shrink:0;width:180px;border:1px solid var(--bd);border-radius:var(--rl);background:var(--sf);overflow:hidden;cursor:pointer;transition:all .2s;position:relative}
.tl-card:hover{transform:translateY(-3px);box-shadow:var(--sm);border-color:var(--g4)}
.tl-thumb{width:100%;height:118px;object-fit:cover;background:var(--sa);display:block}
.tl-thumb-ph{width:100%;height:118px}
.tl-body{padding:12px 14px}
.tl-date{font-size:12px;color:var(--tm);display:flex;align-items:center;gap:5px}
.tl-stage{font-family:var(--fd);font-size:15px;font-weight:600;color:var(--e8);margin:4px 0 8px}
.tl-play{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}

.hbar{height:8px;border-radius:6px;background:var(--bl);overflow:hidden;position:relative}
.hbar-fill{height:100%;border-radius:6px;transition:width .4s}
.hbar-row{display:flex;align-items:center;gap:8px;font-size:12px}
.hbar-val{font-family:var(--fd);font-weight:700;min-width:34px;text-align:right}

.frame-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.frame-card{border:1px solid var(--bd);border-radius:var(--rm);overflow:hidden;background:var(--sf)}
.frame-card .fimg{width:100%;height:110px;object-fit:cover;background:var(--sa);cursor:pointer;display:block}
.frame-card .fimg-ph{width:100%;height:110px;cursor:pointer}
.frame-meta{padding:9px 11px;font-size:12px}

.flag-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:600;margin:3px 4px 0 0}
.flag-low{background:var(--g1);color:var(--g7)} .flag-moderate{background:#fef3c7;color:#92400e} .flag-high{background:var(--r1);color:var(--r5)}

.vid-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.vs-processing{background:#fef3c7;color:#92400e} .vs-analyzed{background:var(--g1);color:var(--g7)} .vs-failed{background:var(--r1);color:var(--r5)} .vs-pending{background:#f0ede8;color:var(--tm)}

.cmp-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cmp-col{border:1px solid var(--bd);border-radius:var(--rl);overflow:hidden;background:var(--sf)}
.cmp-head{padding:14px 16px;border-bottom:1px solid var(--bl);background:var(--sa)}
.cmp-thumb{width:100%;height:150px;object-fit:cover;background:var(--sa);display:block}
.cmp-thumb-ph{width:100%;height:150px}
.cmp-metric{display:flex;justify-content:space-between;align-items:center;padding:9px 16px;font-size:13px;border-bottom:1px solid var(--bl)}
.cmp-metric:last-child{border-bottom:none}
.cmp-delta{border:1px solid var(--g2);background:var(--g0);border-radius:var(--rl);padding:16px 20px;margin-top:16px}

.proc-bar{background:var(--g0);border:1px solid var(--g2);border-radius:var(--rm);padding:14px 18px;display:flex;align-items:center;gap:12px;margin-top:12px;font-size:13px;color:var(--g8)}

/* Responsive */
@media(max-width:900px){
  .sb{transform:translateX(-100%)} .sb.opn{transform:translateX(0)}
  .mn{margin-left:0} .mmb{display:block}
  .ct{padding:20px 16px} .tb{padding:12px 16px}
  .sg{grid-template-columns:repeat(2,1fr)} .g2,.g3{grid-template-columns:1fr}
  .wg{grid-template-columns:repeat(3,1fr)} .fmg{grid-template-columns:repeat(2,1fr)}
  .fr{grid-template-columns:1fr} .yn{grid-template-columns:1fr;gap:12px}
  .media-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
  .fab{bottom:16px;right:16px}
  .cmp-grid{grid-template-columns:1fr}
}
`;

// ─── STORAGE HELPERS ───────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  tasks: "woodlands:tasks",
  observations: "woodlands:observations",
  mediaIndex: "woodlands:media-index",
  settings: "woodlands:settings",
  photoPrefix: "woodlands:photo:",
  videos: "woodlands:videos",
  videoFramePrefix: "woodlands:vframe:",
};

const SEED_MEDIA = [
  { id: 1, src: null, field: "Block A", date: "2026-06-03", type: "pest", note: "Aphid cluster on kale row 5", crop: "kale", placeholder: "aphid-kale" },
  { id: 2, src: null, field: "Block C", date: "2026-06-02", type: "growth", note: "Maize V6 stage, good stand", crop: "maize", placeholder: "maize-growth" },
  { id: 3, src: null, field: "Block B", date: "2026-06-01", type: "disease", note: "Early blight on tomato leaves", crop: "tomato", placeholder: "tomato-blight" },
  { id: 4, src: null, field: "Block A", date: "2026-05-30", type: "harvest", note: "Kale harvest, 120kg bundle", crop: "kale", placeholder: "kale-harvest" },
  { id: 5, src: null, field: "Block D", date: "2026-05-28", type: "growth", note: "Butternut flowering stage", crop: "butternut", placeholder: "butternut-flower" },
];

const SEED_TASKS = [
  { id: 1, text: "Irrigate Block A kale beds", priority: "high", done: false, field: "Block A" },
  { id: 2, text: "Scout Block C for armyworm", priority: "high", done: false, field: "Block C" },
  { id: 3, text: "Apply Bt spray to brassica seedlings", priority: "medium", done: false, field: "Block A" },
  { id: 4, text: "Check borehole pump pressure", priority: "medium", done: false, field: "Infrastructure" },
  { id: 5, text: "Harvest mature kale for market", priority: "high", done: true, field: "Block A" },
  { id: 6, text: "Prepare Block E for next planting cycle", priority: "low", done: false, field: "Block E" },
  { id: 7, text: "Order NPK fertilizer (50kg bags x 20)", priority: "medium", done: false, field: "General" },
];

const SEED_OBS = [
  { id: 1, field: "Block A (Irrigated)", date: "2026-06-01", type: "pest", note: "Aphid clusters on kale underleaf in rows 3-5. Moderate infestation. Applied neem oil.", severity: "medium", photos: [] },
  { id: 2, field: "Block C (Dryland)", date: "2026-05-30", type: "growth", note: "Maize at V6 stage. Good stand density. No visible stress.", severity: "low", photos: [] },
  { id: 3, field: "Block B (Irrigated)", date: "2026-05-28", type: "disease", note: "Early blight symptoms on 3 tomato plants in row 12. Removed affected leaves.", severity: "high", photos: [] },
];

async function storageGet(key, fallback) {
  try {
    const result = await window.storage.get(key);
    return result ? JSON.parse(result.value) : fallback;
  } catch { return fallback; }
}

async function storageSet(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value));
  } catch (e) { console.error("Storage write failed:", key, e); }
}

async function storagePhotoSave(id, base64) {
  try {
    if (!base64 || base64.length > 4500000) return; // skip if too large for 5MB limit
    await window.storage.set(STORAGE_KEYS.photoPrefix + id, base64);
  } catch (e) { console.error("Photo save failed:", id, e); }
}

async function storagePhotoLoad(id) {
  try {
    const result = await window.storage.get(STORAGE_KEYS.photoPrefix + id);
    return result ? result.value : null;
  } catch { return null; }
}

// Generic blob (base64) save/load, used for representative video frames.
async function storageBlobSave(key, base64) {
  try {
    if (!base64 || base64.length > 4500000) return;
    await window.storage.set(key, base64);
  } catch (e) { console.error("Blob save failed:", key, e); }
}

async function storageBlobLoad(key) {
  try {
    const result = await window.storage.get(key);
    return result ? result.value : null;
  } catch { return null; }
}

// ─── VIDEO PURE HELPERS ──────────────────────────────────────────────────────
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const healthColor = (score) => score >= 80 ? "var(--g5)" : score >= 65 ? "var(--gold)" : score >= 50 ? "#e67e22" : "var(--r4)";
const modeOf = (arr) => {
  if (!arr || !arr.length) return null;
  const counts = {};
  arr.forEach(v => { if (v != null) counts[v] = (counts[v] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function WoodlandsFarmManager() {
  const [sec, setSec] = useState("dashboard");
  const [sbOpen, setSbOpen] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const skipSaveRef = useRef(true); // prevent saving during initial load

  // ─── Media / Camera state ──────────────────────────────────────────────────
  const [mediaLib, setMediaLib] = useState(SEED_MEDIA);
  const [cameraActive, setCameraActive] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const walkFileRef = useRef(null);
  const snapFileRef = useRef(null);

  // ─── Video Intelligence state ───────────────────────────────────────────────
  const [videos, setVideos] = useState(SEED_VIDEOS);
  const [walkMode, setWalkMode] = useState("photo"); // photo | video
  const [videoRecording, setVideoRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [recordedIsFile, setRecordedIsFile] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [videoMeta, setVideoMeta] = useState({ fieldId: 1, batchId: "batch-kale-a", crop: "kale" });
  const [videoProcessing, setVideoProcessing] = useState(false);
  const [processStage, setProcessStage] = useState("");
  const [progressField, setProgressField] = useState(1);
  const [progressCrop, setProgressCrop] = useState("kale");
  const [expandedVideo, setExpandedVideo] = useState(null);
  const [cmpBatchA, setCmpBatchA] = useState("batch-kale-a");
  const [cmpBatchB, setCmpBatchB] = useState("batch-kale-b");
  const recordVideoRef = useRef(null);
  const recordStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const videoFileRef = useRef(null);

  // ─── Tasks state ───────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState(SEED_TASKS);
  const [newTask, setNewTask] = useState({ text: "", priority: "medium", field: "Block A (Irrigated)" });

  // ─── Pest state ────────────────────────────────────────────────────────────
  const [pestImage, setPestImage] = useState(null);
  const [pestAnalysis, setPestAnalysis] = useState(null);
  const [pestLoading, setPestLoading] = useState(false);
  const [pestCrop, setPestCrop] = useState("kale");
  const [pestDesc, setPestDesc] = useState("");
  const pestFileRef = useRef(null);

  // ─── Yield state ───────────────────────────────────────────────────────────
  const [yieldCrop, setYieldCrop] = useState("kale");
  const [yieldHa, setYieldHa] = useState(5);
  const [yieldCond, setYieldCond] = useState("average");
  const [yieldRes, setYieldRes] = useState(null);

  // ─── Livestock state ────────────────────────────────────────────────────────
  const [herds, setHerds] = useState(SEED_HERDS);
  const [healthLog, setHealthLog] = useState(SEED_HEALTH_LOG);
  const [lsTab, setLsTab] = useState("overview"); // overview | registry | health | production
  const [lsFilter, setLsFilter] = useState("all"); // all | chickens | cattle | goats | pigs | ostriches
  const [newHealth, setNewHealth] = useState({ herdId: 1, event: "vaccination", detail: "", cost: 0 });
  const [lsAnalysis, setLsAnalysis] = useState(null);
  const [lsAnalyzing, setLsAnalyzing] = useState(false);
  const [lsSymptoms, setLsSymptoms] = useState({ type: "chickens", description: "" });

  // ─── Field Walk state ──────────────────────────────────────────────────────
  const [observations, setObservations] = useState(SEED_OBS);
  const [newObs, setNewObs] = useState({ field: "Block A (Irrigated)", type: "pest", note: "", severity: "medium", photos: [] });

  // ─── WhatsApp state ────────────────────────────────────────────────────────
  const [waMessages, setWaMessages] = useState([
    { text: "Mambo boss. Ndaona mabugs pa kale redu.", from: "worker", time: "08:32" },
    { text: "Tuma photo ndione.", from: "owner", time: "08:34" },
    { text: "[Photo: aphids on kale leaf]", from: "worker", time: "08:36", hasImage: true },
    { text: "AI Analysis: Aphids detected. Apply neem oil (5ml/L water). Spray underside of leaves. Re-apply after 3 days.", from: "system", time: "08:36" },
  ]);
  const [waInput, setWaInput] = useState("");

  // ─── CAMERA FUNCTIONS ─────────────────────────────────────────────────────

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      alert("Camera access denied or unavailable. Use the file upload option instead.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = (targetSection) => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);

    if (targetSection === "walk") {
      setNewObs(p => ({ ...p, photos: [...p.photos, dataUrl] }));
    } else if (targetSection === "pest") {
      setPestImage(dataUrl);
      stopCamera();
      setSec("pest");
    } else {
      addToMediaLib(dataUrl, "General capture");
    }
  };

  const handleFileUpload = (e, target) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        if (target === "walk") {
          setNewObs(p => ({ ...p, photos: [...p.photos, dataUrl] }));
        } else if (target === "pest") {
          setPestImage(dataUrl);
        } else if (target === "media") {
          addToMediaLib(dataUrl, "Uploaded from gallery");
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const addToMediaLib = (src, note, field = "General", type = "general", crop = "") => {
    setMediaLib(p => [{
      id: Date.now(),
      src,
      field,
      date: new Date().toISOString().split("T")[0],
      type,
      note,
      crop,
      placeholder: null,
    }, ...p]);
  };

  const removeObsPhoto = (idx) => {
    setNewObs(p => ({ ...p, photos: p.photos.filter((_, i) => i !== idx) }));
  };

  // ─── VIDEO: RECORDING (MediaRecorder) ──────────────────────────────────────

  const pickRecMime = () => {
    const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    for (const t of types) {
      try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return { mimeType: t }; } catch {}
    }
    return {};
  };

  const stopRecordStream = () => {
    if (recordStreamRef.current) {
      recordStreamRef.current.getTracks().forEach(t => t.stop());
      recordStreamRef.current = null;
    }
  };

  const startVideoRecording = async () => {
    discardRecording();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      recordStreamRef.current = stream;
      if (recordVideoRef.current) { recordVideoRef.current.srcObject = stream; recordVideoRef.current.play(); }
      recordChunksRef.current = [];
      const mr = new MediaRecorder(stream, pickRecMime());
      mr.ondataavailable = (e) => { if (e.data && e.data.size) recordChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: mr.mimeType || "video/webm" });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(URL.createObjectURL(blob));
        setRecordedIsFile(false);
        stopRecordStream();
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setVideoRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds(s => {
          if (s + 1 >= 90) { stopVideoRecording(); return 90; } // 90s in-app cap (spec section 11)
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      alert("Camera access denied or unavailable. Use the Upload Video option instead.");
    }
  };

  const stopVideoRecording = () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    try { if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop(); } catch {}
    setVideoRecording(false);
  };

  const handleVideoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(URL.createObjectURL(file));
    setRecordedIsFile(true);
    e.target.value = "";
  };

  const discardRecording = () => {
    if (videoRecording) stopVideoRecording();
    stopRecordStream();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setRecordedIsFile(false);
    setRecordSeconds(0);
  };

  // ─── VIDEO: CLIENT-SIDE FRAME EXTRACTION ───────────────────────────────────
  // Seeks an off-DOM <video> to evenly spaced timestamps and grabs each frame to a
  // canvas. Mirrors the v1.1 ffmpeg sampling design (skip first ~1s, even spacing),
  // run client-side here; the server ffmpeg path stays for the WhatsApp ingest route.

  const extractFrames = (url, count = 5) => new Promise((resolve, reject) => {
    const vid = document.createElement("video");
    vid.preload = "auto"; vid.muted = true; vid.playsInline = true; vid.crossOrigin = "anonymous"; vid.src = url;
    const canvas = document.createElement("canvas");
    const frames = [];

    const run = (duration) => {
      const dur = isFinite(duration) && duration > 0 ? duration : 5;
      const start = Math.min(1, dur * 0.1);
      const usable = Math.max(0.1, dur - start - 0.05);
      const times = [];
      for (let i = 0; i < count; i++) times.push(+(start + usable * (count === 1 ? 0 : i / (count - 1))).toFixed(2));
      let idx = 0;
      const seekNext = () => {
        if (idx >= times.length) { resolve({ frames, duration: +dur.toFixed(1) }); return; }
        vid.currentTime = Math.min(times[idx], dur - 0.05);
      };
      vid.onseeked = () => {
        canvas.width = vid.videoWidth || 640;
        canvas.height = vid.videoHeight || 480;
        try { canvas.getContext("2d").drawImage(vid, 0, 0, canvas.width, canvas.height); } catch (e) {}
        frames.push({ index: idx, t: +vid.currentTime.toFixed(2), src: canvas.toDataURL("image/jpeg", 0.7), placeholder: null });
        idx++;
        seekNext();
      };
      seekNext();
    };

    vid.onloadedmetadata = () => {
      if (vid.duration === Infinity || isNaN(vid.duration)) {
        // Known webm/MediaRecorder quirk: force duration to resolve before seeking.
        vid.currentTime = 1e6;
        vid.ontimeupdate = () => { vid.ontimeupdate = null; const d = vid.duration; vid.currentTime = 0; run(d); };
      } else {
        run(vid.duration);
      }
    };
    vid.onerror = () => reject(new Error("Could not load the video for frame extraction."));
  });

  // ─── VIDEO: CLAUDE VISION FRAME ANALYSIS ───────────────────────────────────

  const analyzeFrame = async (frameDataUrl, crop, fieldName) => {
    const cropInfo = CROP_DATABASE[crop] || {};
    const ref = GROWTH_STAGE_REF[crop];
    const base64 = frameDataUrl.split(",")[1];
    const mimeMatch = frameDataUrl.match(/data:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const prompt = `You are an agronomy assistant analysing crop field photographs from a horticulture farm in the Midlands Province of Zimbabwe (Kwekwe). The primary crops are maize and English giant rape (kale). Assess the single image provided and respond with JSON only, no preamble and no markdown fences.
Crop: ${cropInfo.name || crop}. Field: ${fieldName || "unknown"}.
${ref ? `Use this ${ref.label} vocabulary for growth_stage: ${ref.stages.join(", ")}.` : ""}
Known pests: ${(cropInfo.pests || []).join(", ")}.
Known diseases: ${(cropInfo.diseases || []).join(", ")}.
Respond ONLY with valid JSON in exactly this shape:
{"growth_stage":"string","health_score":0,"health_flags":[{"type":"yellowing|wilting|nutrient_deficiency|water_stress|other","severity":"low|moderate|high","note":"string"}],"plant_density":"string","weed_pressure":"none|low|moderate|high","pest_disease_signs":[{"label":"string","confidence":"low|medium|high","note":"string"}],"notes":"one or two sentences"}
health_score is an integer 0-100. Use empty arrays when nothing is observed.`;
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
            { type: "text", text: prompt },
          ] }],
        }),
      });
      const data = await resp.json();
      const text = data.content?.map(c => c.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      parsed.health_score = Math.max(0, Math.min(100, parseInt(parsed.health_score) || 0));
      parsed.health_flags = Array.isArray(parsed.health_flags) ? parsed.health_flags : [];
      parsed.pest_disease_signs = Array.isArray(parsed.pest_disease_signs) ? parsed.pest_disease_signs : [];
      return parsed;
    } catch {
      // Heuristic fallback so the walk still produces a timeline entry if the API is unavailable.
      return {
        growth_stage: ref ? ref.stages[Math.floor(ref.stages.length / 2)] : "Unknown",
        health_score: 70,
        health_flags: [],
        plant_density: "Not assessed",
        weed_pressure: "low",
        pest_disease_signs: [],
        notes: "Heuristic fallback (vision API unavailable). Review this frame manually.",
        fallback: true,
      };
    }
  };

  const aggregateAnalyses = (analyses) => {
    const valid = analyses.filter(Boolean);
    if (!valid.length) return null;
    const scores = valid.map(a => Math.max(0, Math.min(100, parseInt(a.health_score) || 0)));
    const meanHealth = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
    const modalStage = modeOf(valid.map(a => a.growth_stage).filter(Boolean)) || "Unknown";
    const flags = valid.flatMap(a => a.health_flags || []);
    const pests = valid.flatMap(a => a.pest_disease_signs || []);
    const weedPressure = modeOf(valid.map(a => a.weed_pressure).filter(Boolean)) || "low";
    const notes = valid.find(a => a.notes && !a.fallback)?.notes || valid[0]?.notes || "";
    return { growth_stage: modalStage, health_score: meanHealth, flags, pests, weedPressure, notes };
  };

  // ─── VIDEO: PROCESSING ORCHESTRATION ───────────────────────────────────────

  const processVideo = async () => {
    if (!recordedUrl) return;
    setVideoProcessing(true);
    const field = FIELDS.find(f => f.id === Number(videoMeta.fieldId));
    const vid = {
      id: "vid-" + Date.now(),
      fieldId: Number(videoMeta.fieldId),
      fieldName: field?.name || "Unknown",
      batchId: videoMeta.batchId || null,
      crop: videoMeta.crop,
      source: recordedIsFile ? "manual_upload" : "app_field_walk",
      capturedAt: new Date().toISOString(),
      durationSeconds: recordSeconds || 0,
      status: "processing",
      frames: [],
      analyses: [],
      aggregate: null,
      representativeFrameIndex: 0,
      createdAt: new Date().toISOString(),
    };
    setVideos(p => [vid, ...p]);
    try {
      setProcessStage("Extracting frames...");
      const { frames, duration } = await extractFrames(recordedUrl, 5);
      setVideos(p => p.map(v => v.id === vid.id ? { ...v, frames, durationSeconds: v.durationSeconds || duration } : v));

      const analyses = [];
      for (let i = 0; i < frames.length; i++) {
        setProcessStage(`Analysing frame ${i + 1} of ${frames.length} with Claude Vision...`);
        const a = await analyzeFrame(frames[i].src, videoMeta.crop, field?.name);
        analyses.push(a ? { ...a, frameIndex: frames[i].index } : null);
      }
      const aggregate = aggregateAnalyses(analyses);
      const repIdx = Math.min(Math.floor(frames.length / 2), Math.max(0, frames.length - 1));
      setVideos(p => p.map(v => v.id === vid.id ? { ...v, analyses: analyses.filter(Boolean), aggregate, representativeFrameIndex: repIdx, status: "analyzed" } : v));
      setProcessStage("Analysis complete.");
      // Jump the timeline to this video's field and crop for immediate review.
      setProgressField(Number(videoMeta.fieldId));
      setProgressCrop(videoMeta.crop);
    } catch (e) {
      setVideos(p => p.map(v => v.id === vid.id ? { ...v, status: "failed" } : v));
      setProcessStage("Processing failed: " + (e.message || "unknown error"));
    }
    setVideoProcessing(false);
    discardRecording();
    setTimeout(() => setProcessStage(""), 4000);
  };

  // ─── Pest Analysis ────────────────────────────────────────────────────────

  const analyzePest = async () => {
    if (!pestDesc && !pestImage) return;
    setPestLoading(true);
    setPestAnalysis(null);
    try {
      const userContent = [];
      if (pestImage) {
        const base64 = pestImage.split(",")[1];
        const mimeMatch = pestImage.match(/data:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
        userContent.push({ type: "image", source: { type: "base64", media_type: mime, data: base64 } });
      }
      userContent.push({ type: "text", text: `You are an agricultural pest and disease expert for Zimbabwe's Midlands Province (Kwekwe). The farmer grows ${CROP_DATABASE[pestCrop]?.name || pestCrop}.
${pestDesc ? `Description: "${pestDesc}"` : "Analyze the uploaded image."}
${pestImage ? "An image of the affected crop has been provided. Analyze it carefully." : ""}
Known pests: ${CROP_DATABASE[pestCrop]?.pests?.join(", ")}
Known diseases: ${CROP_DATABASE[pestCrop]?.diseases?.join(", ")}
Respond ONLY with valid JSON (no markdown, no backticks):
{"identified":"Name","confidence":"High/Medium/Low","description":"Brief description","severity":"Low/Medium/High/Critical","organic_treatments":["t1","t2","t3"],"chemical_treatments":["t1","t2"],"cultural_practices":["p1","p2","p3"],"prevention":["p1","p2"],"timeline":"Action timeline","local_tip":"Zimbabwe-specific tip"}` });

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: userContent }] }),
      });
      const data = await resp.json();
      const text = data.content?.map(c => c.text || "").join("") || "";
      setPestAnalysis(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch {
      setPestAnalysis({
        identified: "Analysis based on symptoms",
        confidence: "Medium",
        description: `Common pest/disease pattern for ${CROP_DATABASE[pestCrop]?.name} in the Kwekwe area.`,
        severity: "Medium",
        organic_treatments: ["Apply neem oil spray (5ml/L)", "Use insecticidal soap", "Introduce beneficial insects"],
        chemical_treatments: ["Consult Cropserve agent for registered products"],
        cultural_practices: ["Rotate crops", "Remove affected leaves", "Improve air circulation"],
        prevention: ["Scout every 3 days", "Maintain crop rotation"],
        timeline: "Act within 24-48 hours",
        local_tip: "Contact Cropserve for locally registered products and dosage.",
      });
    }
    setPestLoading(false);
    if (pestImage) addToMediaLib(pestImage, `Pest analysis: ${pestCrop}`, "Field", "pest", pestCrop);
  };

  // ─── Yield ─────────────────────────────────────────────────────────────────

  const calcYield = () => {
    const c = CROP_DATABASE[yieldCrop]; if (!c) return;
    const m = { poor: .5, "below-average": .7, average: .85, good: 1, excellent: 1.15 }[yieldCond] || .85;
    const mn = c.yieldPerHa.min * yieldHa * m, mx = c.yieldPerHa.max * yieldHa * m;
    setYieldRes({ crop: c.name, ha: yieldHa, cond: yieldCond, min: mn.toFixed(1), max: mx.toFixed(1), avg: ((mn + mx) / 2).toFixed(1), unit: c.yieldPerHa.unit, plants: (c.plantsPerHa * yieldHa).toLocaleString(), dtm: c.daysToMaturity });
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const nav = (s) => { setSec(s); setSbOpen(false); setFabOpen(false); };
  const toggleTask = (id) => setTasks(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const addTask = () => { if (!newTask.text.trim()) return; setTasks(p => [...p, { id: Date.now(), ...newTask, done: false }]); setNewTask({ text: "", priority: "medium", field: "Block A (Irrigated)" }); };

  const addObs = () => {
    if (!newObs.note.trim()) return;
    newObs.photos.forEach(p => addToMediaLib(p, newObs.note, newObs.field, newObs.type));
    setObservations(p => [{ id: Date.now(), ...newObs, date: new Date().toISOString().split("T")[0] }, ...p]);
    setNewObs({ field: "Block A (Irrigated)", type: "pest", note: "", severity: "medium", photos: [] });
    if (cameraActive) stopCamera();
  };

  const sendWa = () => {
    if (!waInput.trim()) return;
    setWaMessages(p => [...p, { text: waInput, from: "owner", time: new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) }]);
    setWaInput("");
  };

  // ─── Livestock functions ───────────────────────────────────────────────────

  const addHealthEntry = () => {
    if (!newHealth.detail.trim()) return;
    setHealthLog(p => [{ id: Date.now(), date: new Date().toISOString().split("T")[0], ...newHealth }, ...p]);
    setNewHealth({ herdId: herds[0]?.id || 1, event: "vaccination", detail: "", cost: 0 });
  };

  const totalAnimals = (type) => herds.filter(h => type === "all" || h.type === type).reduce((s, h) => s + h.count, 0);

  const analyzeLivestockHealth = async () => {
    if (!lsSymptoms.description.trim()) return;
    setLsAnalyzing(true); setLsAnalysis(null);
    const animalInfo = LIVESTOCK_DB[lsSymptoms.type];
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content:
          `You are a veterinary expert for livestock in Zimbabwe's Midlands Province (Kwekwe). The farmer has ${animalInfo.name}.
Known diseases: ${animalInfo.commonDiseases.join(", ")}
Symptoms: "${lsSymptoms.description}"
Respond ONLY with valid JSON (no markdown): {"identified":"Disease name","severity":"Low/Medium/High/Critical","description":"Brief description","immediate_action":["action1","action2"],"treatment":["t1","t2","t3"],"prevention":["p1","p2"],"vet_required":true/false,"local_tip":"Zimbabwe-specific tip"}` }] }),
      });
      const data = await resp.json();
      const text = data.content?.map(c => c.text || "").join("") || "";
      setLsAnalysis(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch {
      setLsAnalysis({ identified: "Requires veterinary assessment", severity: "Medium", description: `Based on symptoms in ${animalInfo.name}, a vet consultation is recommended.`, immediate_action: ["Isolate affected animals", "Monitor closely for 24 hours"], treatment: ["Consult local veterinary officer", "Contact Midlands Province vet services"], prevention: ["Maintain vaccination schedule", "Regular health inspections"], vet_required: true, local_tip: "Contact your nearest Department of Veterinary Services office in Kwekwe." });
    }
    setLsAnalyzing(false);
  };

  // Cleanup on unmount: stop all camera/recording streams and timers.
  useEffect(() => { return () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach(t => t.stop());
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  }; }, []);

  // ─── LOAD DATA FROM PERSISTENT STORAGE ────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      try {
        const [storedTasks, storedObs, storedMediaIndex, storedVideos] = await Promise.all([
          storageGet(STORAGE_KEYS.tasks, null),
          storageGet(STORAGE_KEYS.observations, null),
          storageGet(STORAGE_KEYS.mediaIndex, null),
          storageGet(STORAGE_KEYS.videos, null),
        ]);

        if (storedTasks) setTasks(storedTasks);
        if (storedObs) setObservations(storedObs);

        if (storedMediaIndex && storedMediaIndex.length > 0) {
          const mediaWithPhotos = await Promise.all(
            storedMediaIndex.map(async (item) => {
              if (item.hasStoredPhoto) {
                const photoData = await storagePhotoLoad(item.id);
                return { ...item, src: photoData };
              }
              return item;
            })
          );
          setMediaLib(mediaWithPhotos);
        }

        if (storedVideos && storedVideos.length > 0) {
          // Rehydrate the representative frame for each stored video (others stay placeholders).
          const vids = await Promise.all(storedVideos.map(async (v) => {
            const repSrc = await storageBlobLoad(STORAGE_KEYS.videoFramePrefix + v.id);
            const frames = (v.frames || []).map(f =>
              f.index === v.representativeFrameIndex && repSrc ? { ...f, src: repSrc } : { ...f, src: f.src || null }
            );
            return { ...v, frames };
          }));
          setVideos(vids);
        }
      } catch (e) {
        console.error("Failed to load stored data:", e);
      }
      skipSaveRef.current = false;
      setDataLoaded(true);
    }
    loadData();
  }, []);

  // ─── SAVE DATA TO PERSISTENT STORAGE ──────────────────────────────────────
  useEffect(() => {
    if (skipSaveRef.current) return;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await storageSet(STORAGE_KEYS.tasks, tasks);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch { setSaveStatus("error"); }
    }, 500);
    return () => clearTimeout(timer);
  }, [tasks]);

  useEffect(() => {
    if (skipSaveRef.current) return;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const obsWithoutPhotos = observations.map(o => ({
          ...o,
          photos: o.photos?.map((_, i) => `ref:${o.id}:${i}`) || [],
          photoCount: o.photos?.length || 0,
        }));
        await storageSet(STORAGE_KEYS.observations, obsWithoutPhotos);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch { setSaveStatus("error"); }
    }, 500);
    return () => clearTimeout(timer);
  }, [observations]);

  useEffect(() => {
    if (skipSaveRef.current) return;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const index = mediaLib.map(m => ({ ...m, src: null, hasStoredPhoto: !!m.src }));
        await storageSet(STORAGE_KEYS.mediaIndex, index);
        const withPhotos = mediaLib.filter(m => m.src).slice(0, 15);
        for (const item of withPhotos) {
          await storagePhotoSave(item.id, item.src);
        }
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch { setSaveStatus("error"); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [mediaLib]);

  // Persist videos: store metadata + analyses (frame base64 stripped), keep the
  // representative frame as a separate blob for the 10 most recent videos.
  useEffect(() => {
    if (skipSaveRef.current) return;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const index = videos.map(v => ({
          ...v,
          frames: (v.frames || []).map(f => ({ index: f.index, t: f.t, src: null, placeholder: f.placeholder || "growth" })),
        }));
        await storageSet(STORAGE_KEYS.videos, index);
        for (const v of videos.slice(0, 10)) {
          const rep = (v.frames || []).find(f => f.index === v.representativeFrameIndex);
          if (rep?.src) await storageBlobSave(STORAGE_KEYS.videoFramePrefix + v.id, rep.src);
        }
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch { setSaveStatus("error"); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [videos]);

  const resetAllData = async () => {
    if (!confirm("This will clear all saved data and reset to defaults. Continue?")) return;
    try {
      await window.storage.delete(STORAGE_KEYS.tasks);
      await window.storage.delete(STORAGE_KEYS.observations);
      await window.storage.delete(STORAGE_KEYS.mediaIndex);
      await window.storage.delete(STORAGE_KEYS.videos);
      const photoKeys = await window.storage.list(STORAGE_KEYS.photoPrefix);
      if (photoKeys?.keys) { for (const k of photoKeys.keys) { await window.storage.delete(k); } }
      const frameKeys = await window.storage.list(STORAGE_KEYS.videoFramePrefix);
      if (frameKeys?.keys) { for (const k of frameKeys.keys) { await window.storage.delete(k); } }
    } catch (e) { console.error("Reset failed:", e); }
    setTasks(SEED_TASKS);
    setObservations(SEED_OBS);
    setMediaLib(SEED_MEDIA);
    setVideos(SEED_VIDEOS);
    setSaveStatus("idle");
  };

  const currentMonth = new Date().getMonth();
  const pendingHigh = tasks.filter(t => !t.done && t.priority === "high").length;

  // ─── Placeholder image generator ──────────────────────────────────────────
  const PlaceholderImg = ({ type, size = 160 }) => {
    const colors = { pest: "#e74c3c", disease: "#f39c12", growth: "#27ae60", harvest: "#8e44ad", general: "#2980b9" };
    const icons = { pest: "🐛", disease: "🍂", growth: "🌱", harvest: "📦", general: "📸" };
    return (
      <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${colors[type] || colors.general}22, ${colors[type] || colors.general}44)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <span style={{ fontSize: size > 100 ? 36 : 24 }}>{icons[type] || "📸"}</span>
        <span style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 600, color: colors[type] || colors.general, letterSpacing: .5 }}>{type}</span>
      </div>
    );
  };

  // ─── NAV ───────────────────────────────────────────────────────────────────

  const navSections = [
    { label: "Operations", items: [
      { id: "dashboard", label: "Dashboard", icon: I.Dashboard },
      { id: "crops", label: "Crop Planning", icon: I.Crop },
      { id: "livestock", label: "Livestock", icon: I.Livestock },
      { id: "tasks", label: "Tasks", icon: I.Tasks, badge: pendingHigh || null },
      { id: "fieldwalk", label: "Field Walk", icon: I.Walk },
    ]},
    { label: "Field Intelligence", items: [
      { id: "progress", label: "Crop Progress", icon: I.Film },
      { id: "compare", label: "Compare Batches", icon: I.Compare },
      { id: "pest", label: "Pest Identifier", icon: I.Bug },
      { id: "yield", label: "Yield Estimator", icon: I.Yield },
      { id: "weather", label: "Weather & Season", icon: I.Weather },
    ]},
    { label: "Media & Comms", items: [
      { id: "media", label: "Photo Gallery", icon: I.Gallery },
      { id: "whatsapp", label: "WhatsApp Hub", icon: I.WhatsApp },
    ]},
    { label: "Farm", items: [
      { id: "map", label: "Farm Map", icon: I.Map },
    ]},
  ];

  const titles = {
    dashboard: ["Dashboard", "Overview of Woodlands Farm operations"],
    crops: ["Crop Planning", "Crop library and planting schedules"],
    livestock: ["Livestock Management", "Herds, flocks, health, and production tracking"],
    tasks: ["Task Manager", "Track and assign farm tasks"],
    fieldwalk: ["Field Walk", "Record photo or video observations from the field"],
    progress: ["Crop Progress", "Week-over-week video field intelligence by block"],
    compare: ["Compare Batches", "Side-by-side staggered planting performance"],
    pest: ["Pest & Disease Identifier", "AI-powered diagnosis from photos or descriptions"],
    yield: ["Yield Estimator", "Calculate expected yields by crop and area"],
    weather: ["Weather & Seasons", "Kwekwe climate patterns and planning"],
    media: ["Photo Gallery", "All field photos, observations, and media"],
    whatsapp: ["WhatsApp Hub", "Farm team communication and alerts"],
    map: ["Farm Map", "Visual layout of Woodlands Farm blocks"],
  };

  // ─── Derived: video helpers used in render ─────────────────────────────────
  const analyzedVideos = videos.filter(v => v.status === "analyzed");
  const repFrame = (v) => (v.frames || []).find(f => f.index === v.representativeFrameIndex) || (v.frames || [])[0] || null;
  const batchById = (id) => SEED_BATCHES.find(b => b.id === id);
  const latestVideoForBatch = (batchId) => analyzedVideos
    .filter(v => v.batchId === batchId)
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))[0] || null;

  // ─── Hidden canvas for camera capture ──────────────────────────────────────
  const hiddenCanvas = <canvas ref={canvasRef} style={{ display: "none" }} />;

  // ═════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════════
  return (
    <>
      <style>{CSS}</style>
      {hiddenCanvas}
      <div className="app">

        {/* ─── SIDEBAR ────────────────────────────────────────────── */}
        <aside className={`sb ${sbOpen ? "opn" : ""}`}>
          <div className="sb-h">
            <div className="sb-logo"><div className="sb-icon">🌱</div>Woodlands</div>
            <div className="sb-sub">Farm Manager | Kwekwe, ZW</div>
          </div>
          <nav className="sb-nav">
            {navSections.map(s => (
              <div key={s.label}>
                <div className="ns-t">{s.label}</div>
                {s.items.map(it => (
                  <button key={it.id} className={`ni ${sec === it.id ? "act" : ""}`} onClick={() => nav(it.id)}>
                    <it.icon />{it.label}
                    {it.badge && <span className="bdg">{it.badge}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sb-f">
            <div style={{ marginBottom: 6 }}>Woodlands Farm Manager v1.2</div>
            <div>119.2 ha | Kwekwe, Midlands</div>
            <button onClick={resetAllData} style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,.3)", background: "none", border: "1px solid rgba(255,255,255,.1)", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>Reset Data</button>
          </div>
        </aside>

        {/* ─── MAIN ───────────────────────────────────────────────── */}
        <main className="mn">
          <header className="tb">
            <button className="mmb" onClick={() => setSbOpen(!sbOpen)}>{sbOpen ? <I.X /> : <I.Menu />}</button>
            <div><div className="tb-t">{titles[sec]?.[0]}</div><div className="tb-s">{titles[sec]?.[1]}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--tm)" }}>{new Date().toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
              {saveStatus === "saving" && <span style={{ fontSize: 11, color: "var(--gold)", display: "flex", alignItems: "center", gap: 4 }}><span className="spin" style={{ width: 12, height: 12, borderWidth: 1.5, borderColor: "var(--gold)", borderTopColor: "var(--e7)" }} />Saving...</span>}
              {saveStatus === "saved" && <span style={{ fontSize: 11, color: "var(--g5)", display: "flex", alignItems: "center", gap: 4 }}><I.Check /> Saved</span>}
              {saveStatus === "error" && <span style={{ fontSize: 11, color: "var(--r4)" }}>Save failed</span>}
            </div>
          </header>

          <div className="ct">

            {!dataLoaded && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, gap: 16 }}>
                <span className="spin" style={{ width: 32, height: 32, borderWidth: 3, borderColor: "var(--bd)", borderTopColor: "var(--g5)" }} />
                <p style={{ color: "var(--tm)", fontSize: 14 }}>Loading farm data...</p>
              </div>
            )}

            {/* ═══ DASHBOARD ═══════════════════════════════════════ */}
            {sec === "dashboard" && <>
              <div className="sg">
                <div className="sc grn"><div className="sl">Active Crop Area</div><div className="sv">57 ha</div><div className="ss">of 119.2 ha total (47.8%)</div></div>
                <div className="sc gld"><div className="sl">Livestock</div><div className="sv">{totalAnimals("all")}</div><div className="ss">chickens, cattle, goats, pigs</div></div>
                <div className="sc blu"><div className="sl">Pending Tasks</div><div className="sv">{tasks.filter(t => !t.done).length}</div><div className="ss">{pendingHigh} high priority</div></div>
                <div className="sc ear"><div className="sl">Progress Videos</div><div className="sv">{analyzedVideos.length}</div><div className="ss">analysed field walks</div></div>
              </div>
              <div className="g2">
                <div className="cd">
                  <div className="cd-h"><div className="cd-t">Field Status</div></div>
                  <div className="tw"><table><thead><tr><th>Block</th><th>Ha</th><th>Status</th><th>Crops</th></tr></thead><tbody>
                    {FIELDS.map(f => <tr key={f.id}><td style={{ fontWeight: 600 }}>{f.name}</td><td>{f.hectares}</td><td><span className={`tg ${f.status === "active" ? "tg-g" : f.status === "planted" ? "tg-y" : f.status === "planned" ? "tg-b" : "tg-x"}`}>{f.status}</span></td><td style={{ fontSize: 13, color: "var(--ts)" }}>{f.crops.map(c => CROP_DATABASE[c]?.name || c).join(", ") || "None"}</td></tr>)}
                  </tbody></table></div>
                </div>
                <div className="cd">
                  <div className="cd-h"><div className="cd-t">Recent Photos</div><button className="bt bs bsm" onClick={() => nav("media")}>View All</button></div>
                  <div className="cam-strip">
                    {mediaLib.slice(0, 6).map(m => (
                      <div key={m.id} onClick={() => setLightbox(m)} style={{ width: 72, height: 72, borderRadius: "var(--rs)", overflow: "hidden", flexShrink: 0, cursor: "pointer", border: "2px solid var(--bd)" }}>
                        {m.src ? <img src={m.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <PlaceholderImg type={m.type} size={72} />}
                      </div>
                    ))}
                    <div className="cam-add" onClick={() => nav("fieldwalk")}><I.Camera /></div>
                  </div>
                  <div className="cd-h" style={{ marginTop: 20, marginBottom: 12 }}><div className="cd-t">High Priority Tasks</div></div>
                  {tasks.filter(t => !t.done && t.priority === "high").map(t => (
                    <div key={t.id} className="tki"><div className={`tkc ${t.done ? "chk" : ""}`} onClick={() => toggleTask(t.id)}>{t.done && <I.Check />}</div><span style={{ flex: 1, fontSize: 14 }}>{t.text}</span><span className="tkp" style={{ background: "var(--r1)", color: "var(--r5)" }}>Urgent</span></div>
                  ))}
                </div>
              </div>
            </>}

            {/* ═══ FIELD WALK (photo + video) ══════════════════════ */}
            {sec === "fieldwalk" && <>
              <div className="seg" style={{ marginBottom: 18 }}>
                <button className={walkMode === "photo" ? "on" : ""} onClick={() => setWalkMode("photo")}><I.Camera /> Photo Observation</button>
                <button className={walkMode === "video" ? "on" : ""} onClick={() => { if (cameraActive) stopCamera(); setWalkMode("video"); }}><I.Video /> Video Walk</button>
              </div>

              {walkMode === "photo" && <div className="cd" style={{ marginBottom: 20 }}>
                <div className="cd-h"><div className="cd-t">Record Field Observation</div></div>
                <div className="fr">
                  <div className="fg"><label className="lb">Field / Block</label><select className="sel" value={newObs.field} onChange={e => setNewObs({ ...newObs, field: e.target.value })}>{FIELDS.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}</select></div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div className="fg" style={{ flex: 1 }}><label className="lb">Type</label><select className="sel" value={newObs.type} onChange={e => setNewObs({ ...newObs, type: e.target.value })}>{["pest","disease","growth","irrigation","soil","harvest","general"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}</select></div>
                    <div className="fg" style={{ flex: 1 }}><label className="lb">Severity</label><select className="sel" value={newObs.severity} onChange={e => setNewObs({ ...newObs, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
                  </div>
                </div>
                <div className="fg"><label className="lb">Notes</label><textarea className="ta" value={newObs.note} onChange={e => setNewObs({ ...newObs, note: e.target.value })} placeholder="Describe what you observed in the field..." /></div>

                <div className="fg">
                  <label className="lb">Photos / Camera</label>
                  <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                    <button className="cam-cap-btn cam-live" onClick={cameraActive ? stopCamera : startCamera}>
                      {cameraActive ? <><I.X /> Stop Camera</> : <><I.Camera /> Open Camera</>}
                    </button>
                    <input type="file" accept="image/*" multiple ref={walkFileRef} onChange={e => handleFileUpload(e, "walk")} style={{ display: "none" }} />
                    <button className="cam-cap-btn cam-file" onClick={() => walkFileRef.current?.click()}>
                      <I.Upload /> Upload Photo
                    </button>
                    <input type="file" accept="image/*" capture="environment" ref={snapFileRef} onChange={e => handleFileUpload(e, "walk")} style={{ display: "none" }} />
                  </div>

                  {cameraActive && (
                    <div className="cam-preview" style={{ marginBottom: 12 }}>
                      <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <div className="cam-controls">
                        <button className="cam-stop" onClick={stopCamera}><I.X /></button>
                        <button className="cam-shutter" onClick={() => capturePhoto("walk")} title="Take photo" />
                      </div>
                    </div>
                  )}

                  {newObs.photos.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ts)", marginBottom: 6 }}>{newObs.photos.length} photo{newObs.photos.length > 1 ? "s" : ""} attached</div>
                      <div className="cam-strip">
                        {newObs.photos.map((p, i) => (
                          <div key={i} style={{ position: "relative" }}>
                            <img src={p} alt="" className="cam-thumb" onClick={() => setLightbox({ src: p, note: "New observation photo" })} />
                            <button onClick={() => removeObsPhoto(i)} style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "var(--r4)", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>&times;</button>
                          </div>
                        ))}
                        <div className="cam-add" onClick={() => { if (cameraActive) capturePhoto("walk"); else walkFileRef.current?.click(); }}>
                          <I.Plus />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button className="bt bp" onClick={addObs}><I.Plus /> Save Observation</button>
                  {newObs.photos.length > 0 && (
                    <button className="bt bg" onClick={() => { if (newObs.photos.length > 0) { setPestImage(newObs.photos[0]); setPestDesc(newObs.note); nav("pest"); } }}>
                      <I.Zap /> Send to Pest ID
                    </button>
                  )}
                </div>
              </div>}

              {walkMode === "video" && <div className="cd" style={{ marginBottom: 20 }}>
                <div className="cd-h"><div className="cd-t">Record or Upload a Crop Progress Video</div><span className="tg tg-g">Claude Vision</span></div>
                <div className="fr">
                  <div className="fg"><label className="lb">Field / Block</label>
                    <select className="sel" value={videoMeta.fieldId} onChange={e => setVideoMeta({ ...videoMeta, fieldId: Number(e.target.value) })}>{FIELDS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div className="fg" style={{ flex: 1 }}><label className="lb">Crop</label>
                      <select className="sel" value={videoMeta.crop} onChange={e => { const crop = e.target.value; const firstBatch = SEED_BATCHES.find(b => b.crop === crop); setVideoMeta({ ...videoMeta, crop, batchId: firstBatch?.id || "" }); }}>{Object.entries(CROP_DATABASE).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
                    </div>
                    <div className="fg" style={{ flex: 1 }}><label className="lb">Batch (optional)</label>
                      <select className="sel" value={videoMeta.batchId} onChange={e => setVideoMeta({ ...videoMeta, batchId: e.target.value })}>
                        <option value="">No batch</option>
                        {SEED_BATCHES.filter(b => b.crop === videoMeta.crop).map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <button className="cam-cap-btn cam-live" onClick={videoRecording ? stopVideoRecording : startVideoRecording} disabled={videoProcessing} style={{ opacity: videoProcessing ? .6 : 1 }}>
                    {videoRecording ? <><I.X /> Stop Recording</> : <><I.Video /> Record Video</>}
                  </button>
                  <input type="file" accept="video/*" capture="environment" ref={videoFileRef} onChange={handleVideoFile} style={{ display: "none" }} />
                  <button className="cam-cap-btn cam-file" onClick={() => videoFileRef.current?.click()} disabled={videoRecording || videoProcessing} style={{ opacity: (videoRecording || videoProcessing) ? .6 : 1 }}>
                    <I.Upload /> Upload Video
                  </button>
                </div>

                {videoRecording && (
                  <div className="cam-preview" style={{ marginBottom: 12 }}>
                    <video ref={recordVideoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div className="rec-badge"><span className="rec-dot" /> REC {fmtClock(recordSeconds)} / 1:30</div>
                    <div className="cam-controls">
                      <button className="cam-stop" onClick={stopVideoRecording}><I.X /></button>
                    </div>
                  </div>
                )}

                {recordedUrl && !videoRecording && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="cam-preview" style={{ marginBottom: 12 }}>
                      <video src={recordedUrl} controls playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button className="bt bp" onClick={processVideo} disabled={videoProcessing} style={{ opacity: videoProcessing ? .6 : 1 }}>
                        {videoProcessing ? <><span className="spin" /> Processing...</> : <><I.Zap /> Extract Frames &amp; Analyse</>}
                      </button>
                      <button className="bt bs" onClick={discardRecording} disabled={videoProcessing}><I.Trash /> Discard</button>
                    </div>
                  </div>
                )}

                {videoProcessing && processStage && (
                  <div className="proc-bar"><span className="spin" style={{ width: 16, height: 16, borderColor: "var(--g2)", borderTopColor: "var(--g6)" }} />{processStage}</div>
                )}
                {!videoProcessing && processStage && (
                  <div className="proc-bar" style={{ background: "var(--g0)" }}><I.Check />{processStage} <button className="bt bs bsm" style={{ marginLeft: "auto" }} onClick={() => nav("progress")}>Open Crop Progress</button></div>
                )}

                <p style={{ fontSize: 12, color: "var(--tm)", marginTop: 12, lineHeight: 1.6 }}>
                  Records up to 90 seconds. On analyse, the app samples about 5 evenly spaced frames in the browser and sends each to Claude Vision for growth stage, health score, and pest or disease signs. Results feed the Crop Progress timeline and the batch comparison. The server-side ffmpeg pipeline handles the same job for videos that arrive over WhatsApp.
                </p>
              </div>}

              <div className="cd">
                <div className="cd-h"><div className="cd-t">Observation Log</div></div>
                {observations.map(obs => (
                  <div key={obs.id} className="obc">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, color: "var(--e7)" }}>
                        {obs.field}
                        <span className={`tg ${obs.type === "pest" || obs.type === "disease" ? (obs.severity === "high" ? "tg-r" : "tg-y") : "tg-g"}`} style={{ marginLeft: 8 }}>{obs.type}</span>
                        <span className={`tg ${obs.severity === "high" ? "tg-r" : obs.severity === "medium" ? "tg-y" : "tg-g"}`} style={{ marginLeft: 4 }}>{obs.severity}</span>
                      </span>
                      <span style={{ fontSize: 12, color: "var(--tm)", display: "flex", alignItems: "center", gap: 4 }}><I.Clock />{obs.date}</span>
                    </div>
                    <div style={{ fontSize: 14, color: "var(--ts)" }}>{obs.note}</div>
                    {obs.photos?.length > 0 && typeof obs.photos[0] === "string" && obs.photos[0].startsWith("data:") && (
                      <div className="cam-strip" style={{ marginTop: 8 }}>
                        {obs.photos.map((p, i) => <img key={i} src={p} alt="" className="cam-thumb" onClick={() => setLightbox({ src: p, note: obs.note, field: obs.field, date: obs.date })} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>}

            {/* ═══ PHOTO GALLERY ═══════════════════════════════════ */}
            {sec === "media" && <>
              <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
                <input type="file" accept="image/*" multiple ref={fileRef} onChange={e => handleFileUpload(e, "media")} style={{ display: "none" }} />
                <button className="bt bp" onClick={() => fileRef.current?.click()}><I.Upload /> Upload Photos</button>
                <button className="bt bs" onClick={() => nav("fieldwalk")}><I.Camera /> New Field Walk</button>
                <button className="bt bs" onClick={() => { nav("pest"); }}><I.Bug /> Snap &amp; Identify</button>
              </div>

              <div className="cd">
                <div className="cd-h"><div className="cd-t">All Farm Photos ({mediaLib.length})</div></div>
                <div className="media-grid">
                  {mediaLib.map(m => (
                    <div key={m.id} className="media-card" onClick={() => setLightbox(m)}>
                      {m.src ? <img src={m.src} alt="" /> : <PlaceholderImg type={m.type} />}
                      <div className="media-card-info">
                        <div className="mf">{m.field}</div>
                        <div className="md">{m.date} {m.crop ? `| ${CROP_DATABASE[m.crop]?.name || m.crop}` : ""}</div>
                      </div>
                      <span className={`tg mtag ${m.type === "pest" ? "tg-r" : m.type === "disease" ? "tg-y" : m.type === "harvest" ? "tg-b" : "tg-g"}`} style={{ fontSize: 9 }}>{m.type}</span>
                    </div>
                  ))}
                </div>
                {mediaLib.length === 0 && <p style={{ textAlign: "center", color: "var(--tm)", padding: 40 }}>No photos yet. Use the camera on Field Walk or upload files.</p>}
              </div>
            </>}

            {/* ═══ PEST IDENTIFIER ═════════════════════════════════ */}
            {sec === "pest" && <>
              <div className="g2">
                <div className="cd">
                  <div className="cd-h"><div className="cd-t">Describe or Photograph the Problem</div></div>
                  <div className="fg"><label className="lb">Affected crop</label><select className="sel" value={pestCrop} onChange={e => setPestCrop(e.target.value)}>{Object.entries(CROP_DATABASE).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></div>
                  <div className="fg"><label className="lb">Describe symptoms</label><textarea className="ta" value={pestDesc} onChange={e => setPestDesc(e.target.value)} placeholder="e.g. Small green insects on leaf undersides. Leaves curling and yellowing." /></div>

                  <div className="fg">
                    <label className="lb">Photo of affected crop</label>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <input type="file" accept="image/*" capture="environment" ref={pestFileRef} onChange={e => handleFileUpload(e, "pest")} style={{ display: "none" }} />
                      <button className="cam-cap-btn cam-live" onClick={() => pestFileRef.current?.click()}><I.Camera /> Take Photo</button>
                      <input type="file" accept="image/*" onChange={e => handleFileUpload(e, "pest")} style={{ display: "none" }} id="pestGallery" />
                      <button className="cam-cap-btn cam-file" onClick={() => document.getElementById("pestGallery")?.click()}><I.Upload /> From Gallery</button>
                    </div>
                    {pestImage && (
                      <div className="puz has" style={{ cursor: "default" }}>
                        <img src={pestImage} alt="Crop" />
                        <button className="bt bd bsm" style={{ marginTop: 8 }} onClick={() => setPestImage(null)}><I.Trash /> Remove</button>
                      </div>
                    )}
                    {!pestImage && (
                      <div className="puz" onClick={() => pestFileRef.current?.click()}>
                        <I.Camera /><p style={{ marginTop: 8, color: "var(--tm)", fontSize: 14 }}>Tap to take a photo or upload from gallery</p>
                      </div>
                    )}
                  </div>

                  <button className="bt bp" onClick={analyzePest} disabled={pestLoading || (!pestDesc && !pestImage)} style={{ width: "100%", justifyContent: "center", opacity: pestLoading || (!pestDesc && !pestImage) ? .6 : 1 }}>
                    {pestLoading ? <><span className="spin" /> Analyzing...</> : <><I.Zap /> Identify &amp; Get Treatment</>}
                  </button>
                </div>

                <div>
                  {pestAnalysis && (
                    <div className="ar">
                      <h3><I.Alert style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />{pestAnalysis.identified}</h3>
                      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                        <span className={`tg ${pestAnalysis.severity === "Critical" || pestAnalysis.severity === "High" ? "tg-r" : pestAnalysis.severity === "Medium" ? "tg-y" : "tg-g"}`}>{pestAnalysis.severity} Severity</span>
                        <span className="tg tg-b">{pestAnalysis.confidence} Confidence</span>
                      </div>
                      <p style={{ fontSize: 14, marginBottom: 20, color: "var(--ts)", lineHeight: 1.6 }}>{pestAnalysis.description}</p>
                      {[["Organic Treatments", pestAnalysis.organic_treatments, "var(--g7)", I.Leaf],
                        ["Chemical Treatments", pestAnalysis.chemical_treatments, "var(--b5)", I.Drop],
                        ["Cultural Practices", pestAnalysis.cultural_practices, "var(--e5)", I.Check],
                        ["Prevention", pestAnalysis.prevention, "var(--ts)", I.Check]].map(([title, items, color, Icon]) => (
                        <div key={title} style={{ marginBottom: 14 }}>
                          <div className="ts-h" style={{ color }}>{title}</div>
                          {items?.map((t, i) => <div key={i} className="ti"><Icon /><span>{t}</span></div>)}
                        </div>
                      ))}
                      <div style={{ background: "var(--g1)", borderRadius: "var(--rm)", padding: 14, marginTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--g8)", marginBottom: 4 }}>Action Timeline</div>
                        <div style={{ fontSize: 13, color: "var(--g7)" }}>{pestAnalysis.timeline}</div>
                      </div>
                      {pestAnalysis.local_tip && <div style={{ background: "#fef3c7", borderRadius: "var(--rm)", padding: 14, marginTop: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>Tip</div>
                        <div style={{ fontSize: 13, color: "#78350f" }}>{pestAnalysis.local_tip}</div>
                      </div>}
                    </div>
                  )}
                  {!pestAnalysis && <div className="cd" style={{ textAlign: "center", padding: 40 }}><I.Bug /><p style={{ marginTop: 12, color: "var(--tm)", fontSize: 14 }}>Take a photo or describe symptoms to get AI-powered pest identification with Zimbabwe-specific treatment advice.</p></div>}
                </div>
              </div>
            </>}

            {/* === CROP PLANNING === */}
            {sec === "crops" && <div className="g3">
              {Object.entries(CROP_DATABASE).map(([k, c]) => (
                <div key={k} className="cd" style={{ padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><I.Leaf /><span style={{ fontFamily: "var(--fd)", fontSize: 16, fontWeight: 600 }}>{c.name}</span></div>
                  <div style={{ fontSize: 12, color: "var(--tm)", marginBottom: 12 }}>{c.family} | {c.season}</div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Maturity:</strong> {c.daysToMaturity[0]}-{c.daysToMaturity[1]} days</div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Yield/ha:</strong> {c.yieldPerHa.min}-{c.yieldPerHa.max} {c.yieldPerHa.unit}</div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Spacing:</strong> {c.spacingCm.row}cm x {c.spacingCm.plant}cm</div>
                  <div style={{ fontSize: 13, marginBottom: 12 }}><strong>Water:</strong> {c.waterNeeds}</div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tm)", marginBottom: 4 }}>PESTS</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{c.pests.slice(0, 3).map(p => <span key={p} className="tg tg-r" style={{ fontSize: 10 }}>{p}</span>)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tm)", marginBottom: 4 }}>COMPANIONS</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{c.companionPlants.map(p => <span key={p} className="tg tg-g" style={{ fontSize: 10 }}>{p}</span>)}</div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--ts)", marginTop: 12, fontStyle: "italic" }}>{c.notes}</p>
                </div>
              ))}
            </div>}

            {/* === LIVESTOCK MANAGEMENT === */}
            {sec === "livestock" && <>
              <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
                {[["overview","Overview"],["registry","Herd Registry"],["health","Health & Vet"],["production","Breeds & Info"]].map(([id,label]) => (
                  <button key={id} className={`bt ${lsTab === id ? "bp" : "bs"} bsm`} onClick={() => setLsTab(id)}>{label}</button>
                ))}
              </div>

              {lsTab === "overview" && <>
                <div className="sg">
                  {Object.entries(LIVESTOCK_DB).map(([key, animal]) => {
                    const count = totalAnimals(key);
                    return <div key={key} className="sc grn" style={{ cursor: "pointer" }} onClick={() => { setLsFilter(key); setLsTab("registry"); }}>
                      <div className="sl">{animal.icon} {animal.name}</div>
                      <div className="sv">{count}</div>
                      <div className="ss">{herds.filter(h => h.type === key).length} group{herds.filter(h => h.type === key).length !== 1 ? "s" : ""}</div>
                    </div>;
                  })}
                </div>

                <div className="g2">
                  <div className="cd">
                    <div className="cd-h"><div className="cd-t">Recent Health Events</div><button className="bt bs bsm" onClick={() => setLsTab("health")}>View All</button></div>
                    {healthLog.slice(0, 5).map(entry => {
                      const herd = herds.find(h => h.id === entry.herdId);
                      return <div key={entry.id} className="tki">
                        <span className={`tg ${entry.event === "vaccination" ? "tg-g" : entry.event === "mortality" ? "tg-r" : entry.event === "treatment" ? "tg-y" : "tg-b"}`} style={{ fontSize: 10, minWidth: 70, justifyContent: "center" }}>{entry.event}</span>
                        <span style={{ flex: 1, fontSize: 13 }}>{entry.detail}</span>
                        <span style={{ fontSize: 11, color: "var(--tm)" }}>{entry.date}</span>
                      </div>;
                    })}
                  </div>

                  <div className="cd">
                    <div className="cd-h"><div className="cd-t">Upcoming Vaccinations</div></div>
                    {Object.entries(LIVESTOCK_DB).flatMap(([type, animal]) =>
                      animal.vaccinations.filter(v => v.critical).slice(0, 2).map((v, i) => (
                        <div key={`${type}-${i}`} className="tki">
                          <span style={{ fontSize: 16, width: 28 }}>{animal.icon}</span>
                          <span style={{ flex: 1, fontSize: 13 }}><strong>{v.disease}</strong><br/><span style={{ fontSize: 11, color: "var(--tm)" }}>{v.schedule}</span></span>
                          <span className="tg tg-r" style={{ fontSize: 9 }}>Critical</span>
                        </div>
                      ))
                    ).slice(0, 8)}
                  </div>
                </div>

                <div className="cd">
                  <div className="cd-h"><div className="cd-t"><I.Heart style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />AI Livestock Health Advisor</div></div>
                  <div className="fr">
                    <div className="fg">
                      <label className="lb">Animal type</label>
                      <select className="sel" value={lsSymptoms.type} onChange={e => setLsSymptoms({...lsSymptoms, type: e.target.value})}>
                        {Object.entries(LIVESTOCK_DB).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.name}</option>)}
                      </select>
                    </div>
                    <div className="fg">
                      <label className="lb">Describe symptoms</label>
                      <input className="inp" value={lsSymptoms.description} onChange={e => setLsSymptoms({...lsSymptoms, description: e.target.value})} placeholder="e.g. 3 hens with watery droppings, droopy wings, not eating" onKeyDown={e => e.key === "Enter" && analyzeLivestockHealth()} />
                    </div>
                  </div>
                  <button className="bt bp" onClick={analyzeLivestockHealth} disabled={lsAnalyzing || !lsSymptoms.description.trim()} style={{ opacity: lsAnalyzing || !lsSymptoms.description.trim() ? .6 : 1 }}>
                    {lsAnalyzing ? <><span className="spin" /> Analyzing...</> : <><I.Zap /> Diagnose</>}
                  </button>
                  {lsAnalysis && <div className="ar" style={{ marginTop: 16 }}>
                    <h3>{lsAnalysis.identified}</h3>
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                      <span className={`tg ${lsAnalysis.severity === "Critical" || lsAnalysis.severity === "High" ? "tg-r" : "tg-y"}`}>{lsAnalysis.severity}</span>
                      {lsAnalysis.vet_required && <span className="tg tg-r">Vet Required</span>}
                    </div>
                    <p style={{ fontSize: 14, color: "var(--ts)", marginBottom: 12 }}>{lsAnalysis.description}</p>
                    <div style={{ marginBottom: 10 }}><div className="ts-h" style={{ color: "var(--r5)" }}>Immediate Action</div>{lsAnalysis.immediate_action?.map((a,i) => <div key={i} className="ti"><I.Alert /><span>{a}</span></div>)}</div>
                    <div style={{ marginBottom: 10 }}><div className="ts-h" style={{ color: "var(--g7)" }}>Treatment</div>{lsAnalysis.treatment?.map((t,i) => <div key={i} className="ti"><I.Check /><span>{t}</span></div>)}</div>
                    <div><div className="ts-h">Prevention</div>{lsAnalysis.prevention?.map((p,i) => <div key={i} className="ti"><I.Leaf /><span>{p}</span></div>)}</div>
                    {lsAnalysis.local_tip && <div style={{ background: "#fef3c7", borderRadius: "var(--rm)", padding: 12, marginTop: 12, fontSize: 13, color: "#78350f" }}><strong>Zimbabwe Tip:</strong> {lsAnalysis.local_tip}</div>}
                  </div>}
                </div>
              </>}

              {lsTab === "registry" && <>
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {[["all","All"],["chickens","🐔 Chickens"],["cattle","🐄 Cattle"],["goats","🐐 Goats"],["pigs","🐷 Pigs"],["ostriches","🦅 Ostriches"]].map(([k,l]) => (
                    <button key={k} className={`bt ${lsFilter === k ? "bp" : "bs"} bsm`} onClick={() => setLsFilter(k)}>{l}</button>
                  ))}
                </div>
                <div className="cd">
                  <div className="cd-h"><div className="cd-t">Herd/Flock Registry ({totalAnimals(lsFilter)} {lsFilter === "all" ? "animals" : LIVESTOCK_DB[lsFilter]?.unit || ""})</div></div>
                  <div className="tw"><table><thead><tr><th>Type</th><th>Breed</th><th>Count</th><th>Purpose</th><th>Location</th><th>Status</th></tr></thead><tbody>
                    {herds.filter(h => lsFilter === "all" || h.type === lsFilter).map(h => (
                      <tr key={h.id}>
                        <td>{LIVESTOCK_DB[h.type]?.icon} {LIVESTOCK_DB[h.type]?.name}</td>
                        <td style={{ fontWeight: 600 }}>{h.breed}</td>
                        <td>{h.count}</td>
                        <td>{h.purpose}</td>
                        <td style={{ fontSize: 12, color: "var(--ts)" }}>{h.location}</td>
                        <td><span className={`tg ${h.status === "producing" ? "tg-g" : h.status === "growing" ? "tg-y" : h.status === "breeding" ? "tg-b" : "tg-x"}`}>{h.status}</span></td>
                      </tr>
                    ))}
                  </tbody></table></div>
                </div>
              </>}

              {lsTab === "health" && <>
                <div className="cd" style={{ marginBottom: 20 }}>
                  <div className="cd-h"><div className="cd-t">Log Health Event</div></div>
                  <div className="fr">
                    <div className="fg">
                      <label className="lb">Herd/Flock</label>
                      <select className="sel" value={newHealth.herdId} onChange={e => setNewHealth({...newHealth, herdId: parseInt(e.target.value)})}>
                        {herds.map(h => <option key={h.id} value={h.id}>{LIVESTOCK_DB[h.type]?.icon} {h.breed} ({h.count} {LIVESTOCK_DB[h.type]?.unit})</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div className="fg" style={{ flex: 1 }}><label className="lb">Event type</label>
                        <select className="sel" value={newHealth.event} onChange={e => setNewHealth({...newHealth, event: e.target.value})}>
                          {["vaccination","deworming","dipping","treatment","mortality","inspection","breeding"].map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase()+e.slice(1)}</option>)}
                        </select>
                      </div>
                      <div className="fg" style={{ flex: 0.5 }}><label className="lb">Cost (USD)</label>
                        <input type="number" className="inp" value={newHealth.cost} onChange={e => setNewHealth({...newHealth, cost: parseFloat(e.target.value) || 0})} min="0" />
                      </div>
                    </div>
                  </div>
                  <div className="fg"><label className="lb">Details</label><input className="inp" value={newHealth.detail} onChange={e => setNewHealth({...newHealth, detail: e.target.value})} placeholder="e.g. Newcastle Disease booster, all 250 birds" onKeyDown={e => e.key === "Enter" && addHealthEntry()} /></div>
                  <button className="bt bp" onClick={addHealthEntry}><I.Plus /> Log Event</button>
                </div>
                <div className="cd">
                  <div className="cd-h"><div className="cd-t">Health Log</div></div>
                  <div className="tw"><table><thead><tr><th>Date</th><th>Animal</th><th>Event</th><th>Details</th><th>Cost</th></tr></thead><tbody>
                    {healthLog.map(entry => {
                      const herd = herds.find(h => h.id === entry.herdId);
                      return <tr key={entry.id}>
                        <td style={{ fontSize: 12 }}>{entry.date}</td>
                        <td>{herd ? `${LIVESTOCK_DB[herd.type]?.icon} ${herd.breed}` : "Unknown"}</td>
                        <td><span className={`tg ${entry.event === "vaccination" ? "tg-g" : entry.event === "mortality" ? "tg-r" : entry.event === "treatment" ? "tg-y" : "tg-b"}`} style={{ fontSize: 10 }}>{entry.event}</span></td>
                        <td style={{ fontSize: 13 }}>{entry.detail}</td>
                        <td>${entry.cost}</td>
                      </tr>;
                    })}
                  </tbody></table></div>
                </div>
              </>}

              {lsTab === "production" && <>
                {Object.entries(LIVESTOCK_DB).map(([key, animal]) => (
                  <div key={key} className="cd" style={{ marginBottom: 16 }}>
                    <div className="cd-h"><div className="cd-t">{animal.icon} {animal.name}</div><span className="tg tg-x">{animal.feedPerDay}</span></div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tm)", marginBottom: 6 }}>BREEDS</div>
                      <div className="tw"><table><thead><tr><th>Breed</th><th>Purpose</th><th>Weight</th><th>Notes</th></tr></thead><tbody>
                        {animal.breeds.map((b, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{b.name}</td><td>{b.purpose}</td><td style={{ fontSize: 12 }}>{b.matureWeight}</td><td style={{ fontSize: 12, color: "var(--ts)" }}>{b.notes}</td></tr>)}
                      </tbody></table></div>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tm)", marginBottom: 6 }}>VACCINATION SCHEDULE (ZIMBABWE)</div>
                      <div className="tw"><table><thead><tr><th>Disease</th><th>Schedule</th><th>Vaccine</th><th>Priority</th></tr></thead><tbody>
                        {animal.vaccinations.map((v, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{v.disease}</td><td style={{ fontSize: 12 }}>{v.schedule}</td><td style={{ fontSize: 12 }}>{v.vaccine}</td><td><span className={`tg ${v.critical ? "tg-r" : "tg-y"}`} style={{ fontSize: 9 }}>{v.critical ? "Critical" : "Recommended"}</span></td></tr>)}
                      </tbody></table></div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tm)", marginBottom: 6 }}>COMMON DISEASES</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{animal.commonDiseases.map(d => <span key={d} className="tg tg-r" style={{ fontSize: 10 }}>{d}</span>)}</div>
                    </div>
                  </div>
                ))}
              </>}
            </>}

            {/* === TASKS === */}
            {sec === "tasks" && <>
              <div className="cd" style={{ marginBottom: 20 }}>
                <div className="cd-h"><div className="cd-t">Add Task</div></div>
                <div className="fr">
                  <div className="fg"><label className="lb">Description</label><input className="inp" value={newTask.text} onChange={e => setNewTask({ ...newTask, text: e.target.value })} placeholder="e.g. Scout Block C for armyworm" onKeyDown={e => e.key === "Enter" && addTask()} /></div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div className="fg" style={{ flex: 1 }}><label className="lb">Priority</label><select className="sel" value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
                    <div className="fg" style={{ flex: 1 }}><label className="lb">Field</label><select className="sel" value={newTask.field} onChange={e => setNewTask({ ...newTask, field: e.target.value })}>{FIELDS.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}<option value="General">General</option></select></div>
                    <div className="fg" style={{ display: "flex", alignItems: "flex-end" }}><button className="bt bp" onClick={addTask}><I.Plus /></button></div>
                  </div>
                </div>
              </div>
              <div className="cd">
                <div className="cd-h"><div className="cd-t">Tasks ({tasks.filter(t => !t.done).length} pending)</div></div>
                {tasks.filter(t => !t.done).map(t => (
                  <div key={t.id} className="tki">
                    <div className={`tkc ${t.done ? "chk" : ""}`} onClick={() => toggleTask(t.id)}>{t.done && <I.Check />}</div>
                    <span style={{ flex: 1, fontSize: 14 }}>{t.text}</span>
                    <span className="tg tg-x" style={{ fontSize: 10 }}>{t.field}</span>
                    <span className="tkp" style={{ background: t.priority === "high" ? "var(--r1)" : t.priority === "medium" ? "#fef3c7" : "var(--g1)", color: t.priority === "high" ? "var(--r5)" : t.priority === "medium" ? "#92400e" : "var(--g7)" }}>{t.priority}</span>
                  </div>
                ))}
                {tasks.some(t => t.done) && <>
                  <div style={{ padding: "16px 14px 8px", fontSize: 12, fontWeight: 600, color: "var(--tm)", textTransform: "uppercase" }}>Completed ({tasks.filter(t => t.done).length})</div>
                  {tasks.filter(t => t.done).map(t => (
                    <div key={t.id} className="tki" style={{ opacity: .5 }}><div className="tkc chk" onClick={() => toggleTask(t.id)}><I.Check /></div><span style={{ flex: 1, fontSize: 14, textDecoration: "line-through" }}>{t.text}</span></div>
                  ))}
                </>}
              </div>
            </>}

            {/* === YIELD === */}
            {sec === "yield" && <div className="g2">
              <div className="cd">
                <div className="cd-h"><div className="cd-t">Yield Calculator</div></div>
                <div className="fg"><label className="lb">Crop</label><select className="sel" value={yieldCrop} onChange={e => setYieldCrop(e.target.value)}>{Object.entries(CROP_DATABASE).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></div>
                <div className="fg"><label className="lb">Area (hectares)</label><input type="number" className="inp" value={yieldHa} onChange={e => setYieldHa(Math.max(0.1, parseFloat(e.target.value) || 0))} min="0.1" step="0.5" /></div>
                <div className="fg"><label className="lb">Conditions</label><select className="sel" value={yieldCond} onChange={e => setYieldCond(e.target.value)}><option value="poor">Poor</option><option value="below-average">Below Average</option><option value="average">Average</option><option value="good">Good (irrigated)</option><option value="excellent">Excellent</option></select></div>
                <button className="bt bp" onClick={calcYield} style={{ width: "100%", justifyContent: "center" }}><I.Yield /> Calculate</button>
              </div>
              <div>
                {yieldRes ? <div className="yr"><h3 style={{ fontFamily: "var(--fd)", fontSize: 20, marginBottom: 16, opacity: .95 }}>Yield: {yieldRes.crop}</h3><div className="yn"><div><div className="ynv">{yieldRes.min}</div><div className="ynl">Min ({yieldRes.unit})</div></div><div><div className="ynv" style={{ color: "var(--gold3)" }}>{yieldRes.avg}</div><div className="ynl">Expected</div></div><div><div className="ynv">{yieldRes.max}</div><div className="ynl">Max</div></div></div><div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.15)", fontSize: 13, opacity: .8 }}><p><strong>Area:</strong> {yieldRes.ha} ha | <strong>Condition:</strong> {yieldRes.cond} | <strong>Plants:</strong> {yieldRes.plants}</p></div></div> : <div className="cd" style={{ textAlign: "center", padding: 40 }}><I.Yield /><p style={{ marginTop: 12, color: "var(--tm)", fontSize: 14 }}>Select crop, area, and conditions to estimate yield.</p></div>}
              </div>
            </div>}

            {/* === WEATHER === */}
            {sec === "weather" && <>
              <div className="cd" style={{ marginBottom: 20 }}>
                <div className="cd-h"><div className="cd-t">Kwekwe Climate Calendar</div><span className="tg tg-g">Midlands Province</span></div>
                <div className="wg">
                  {WEATHER_SEASONS_ZW.map((m, i) => (
                    <div key={m.month} className={`wm ${i === currentMonth ? "cur" : ""}`}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ts)" }}>{m.month}</div>
                      <div style={{ fontFamily: "var(--fd)", fontSize: 20, fontWeight: 700, color: "var(--e7)", margin: "4px 0" }}>{m.temp}&#176;</div>
                      <div style={{ fontSize: 11, color: "var(--b5)", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><I.Drop />{m.rain}mm</div>
                      <div style={{ fontSize: 9, padding: "2px 6px", borderRadius: 8, marginTop: 4, display: "inline-block", background: m.season === "Hot Wet" ? "var(--g1)" : m.season === "Cool Dry" ? "var(--b1)" : "#fef3c7", color: m.season === "Hot Wet" ? "var(--g7)" : m.season === "Cool Dry" ? "var(--b5)" : "#92400e" }}>{m.season}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>}

            {/* === WHATSAPP === */}
            {sec === "whatsapp" && <div className="g2">
              <div className="cd">
                <div className="cd-h"><div className="cd-t">Farm Team Chat</div><span className="tg tg-g">WhatsApp Bridge</span></div>
                <div className="wac">
                  {waMessages.map((msg, i) => (
                    <div key={i} className={`wam ${msg.from === "owner" ? "snt" : "rcv"}`} style={msg.from === "system" ? { background: "#fff3cd", borderTopLeftRadius: 12, fontStyle: "italic", fontSize: 13 } : {}}>
                      {msg.from === "worker" && <div style={{ fontSize: 11, fontWeight: 600, color: "var(--g7)", marginBottom: 2 }}>Farm Worker</div>}
                      {msg.from === "system" && <div style={{ fontSize: 11, fontWeight: 600, color: "#856404", marginBottom: 2 }}>AI Assistant</div>}
                      {msg.text}
                      <div className="wat">{msg.time}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <input className="inp" value={waInput} onChange={e => setWaInput(e.target.value)} placeholder="Type a message..." onKeyDown={e => e.key === "Enter" && sendWa()} />
                  <button className="bt bp" onClick={sendWa}><I.Send /></button>
                </div>
              </div>
              <div className="cd">
                <div className="cd-t" style={{ marginBottom: 16 }}>WhatsApp + Camera Integration</div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--ts)" }}>
                  <p>In production, the WhatsApp Business API webhook handles:</p>
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      ["Photo Pest ID", "Worker sends crop photo via WhatsApp. Webhook receives image, routes to Claude Vision API, returns treatment. Photo auto-saved to gallery."],
                      ["Video Walk Ingest", "Worker sends a short clip. Server ffmpeg samples frames, runs Claude Vision per frame, and posts the growth-stage and health summary to the Crop Progress timeline."],
                      ["Task Updates", "Push tasks to workers. They reply done + optional photo proof."],
                      ["Weather Alerts", "Automated frost, rain, or heat warnings to all workers."],
                      ["Harvest Logging", "Worker sends tally + photo. System logs weight and field."],
                      ["Multilingual", "Shona, Ndebele, and English support."],
                    ].map(([t, d]) => (
                      <div key={t} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <I.Check style={{ color: "var(--g5)", flexShrink: 0, marginTop: 3 }} />
                        <span><strong>{t}:</strong> {d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>}

            {/* === FARM MAP === */}
            {sec === "map" && <>
              <div className="cd" style={{ marginBottom: 20 }}>
                <div className="cd-h">
                  <div className="cd-t">Woodlands Farm Layout</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, flexWrap: "wrap" }}>
                    {[["Active","var(--g1)","var(--g4)"],["Planted","#fef9c3","#fbbf24"],["Fallow","var(--e1)","var(--e3)"],["Planned","var(--b1)","#93c5fd"]].map(([l,bg,bc]) => (
                      <span key={l}><span style={{ display: "inline-block", width: 12, height: 12, background: bg, border: `2px solid ${bc}`, borderRadius: 3, verticalAlign: "middle", marginRight: 4 }}/>{l}</span>
                    ))}
                  </div>
                </div>
                <div className="fmg">
                  {FIELDS.map(f => (
                    <div key={f.id} className={`mb ${f.status}`} style={[3,4,8].includes(f.id) ? { gridColumn: "span 2" } : {}}>
                      <div style={{ fontWeight: 600, color: "var(--e8)", fontSize: 11 }}>{f.name}</div>
                      <div style={{ fontFamily: "var(--fd)", fontSize: 18, fontWeight: 700, color: "var(--e7)" }}>{f.hectares} ha</div>
                      <div style={{ fontSize: 10, color: "var(--ts)" }}>{f.crops.map(c => CROP_DATABASE[c]?.name || c).join(", ") || "No crops"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>}

            {/* ═══ CROP PROGRESS (video timeline) ══════════════════ */}
            {sec === "progress" && (() => {
              const filtered = videos
                .filter(v => v.fieldId === Number(progressField) && v.crop === progressCrop)
                .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
              const analysed = filtered.filter(v => v.status === "analyzed" && v.aggregate);
              const first = analysed[0], last = analysed[analysed.length - 1];
              const delta = first && last ? last.aggregate.health_score - first.aggregate.health_score : null;
              return <>
                <div className="cd" style={{ marginBottom: 20 }}>
                  <div className="cd-h"><div className="cd-t">Timeline Filters</div><span className="tg tg-x">{filtered.length} walk{filtered.length !== 1 ? "s" : ""}</span></div>
                  <div className="fr">
                    <div className="fg"><label className="lb">Field / Block</label>
                      <select className="sel" value={progressField} onChange={e => setProgressField(Number(e.target.value))}>{FIELDS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                    </div>
                    <div className="fg"><label className="lb">Crop</label>
                      <select className="sel" value={progressCrop} onChange={e => setProgressCrop(e.target.value)}>{Object.entries(CROP_DATABASE).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
                    </div>
                  </div>
                  {delta !== null && <div style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 6 }}>
                    <div><div className="sl">Latest Stage</div><div style={{ fontFamily: "var(--fd)", fontSize: 18, fontWeight: 700, color: "var(--e8)" }}>{last.aggregate.growth_stage}</div></div>
                    <div><div className="sl">Latest Health</div><div style={{ fontFamily: "var(--fd)", fontSize: 18, fontWeight: 700, color: healthColor(last.aggregate.health_score) }}>{last.aggregate.health_score}/100</div></div>
                    <div><div className="sl">Trend (first to last)</div><div style={{ fontFamily: "var(--fd)", fontSize: 18, fontWeight: 700, color: delta >= 0 ? "var(--g5)" : "var(--r4)" }}>{delta >= 0 ? "+" : ""}{delta} pts</div></div>
                  </div>}
                </div>

                <div className="cd">
                  <div className="cd-h"><div className="cd-t">Progress Timeline</div><button className="bt bs bsm" onClick={() => { setWalkMode("video"); nav("fieldwalk"); }}><I.Video /> New Video Walk</button></div>
                  {filtered.length === 0 && <p style={{ textAlign: "center", color: "var(--tm)", padding: 40 }}>No video walks for this block and crop yet. Record one from Field Walk, Video Walk.</p>}
                  {filtered.length > 0 && <div className="tl-strip">
                    {filtered.map(v => {
                      const rf = repFrame(v);
                      const agg = v.aggregate;
                      return <div key={v.id} className="tl-card" onClick={() => v.status === "analyzed" && setExpandedVideo(v)}>
                        {v.status === "analyzed" && <div className="tl-play"><I.Play /></div>}
                        {rf?.src ? <img className="tl-thumb" src={rf.src} alt="" /> : <div className="tl-thumb-ph"><PlaceholderImg type="growth" size={118} /></div>}
                        <div className="tl-body">
                          <div className="tl-date"><I.Clock /> {new Date(v.capturedAt).toLocaleDateString("en-ZW", { day: "numeric", month: "short" })}</div>
                          {v.status === "analyzed" && agg ? <>
                            <div className="tl-stage">{agg.growth_stage}</div>
                            <div className="hbar-row"><div className="hbar" style={{ flex: 1 }}><div className="hbar-fill" style={{ width: `${agg.health_score}%`, background: healthColor(agg.health_score) }} /></div><span className="hbar-val" style={{ color: healthColor(agg.health_score) }}>{agg.health_score}</span></div>
                            <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              {v.batchId ? <span className="tg tg-x" style={{ fontSize: 9 }}>{batchById(v.batchId)?.label || "Batch"}</span> : <span />}
                              <span className="vid-status vs-analyzed"><I.Check /> Analysed</span>
                            </div>
                          </> : <>
                            <div className="tl-stage" style={{ color: "var(--tm)" }}>{v.status === "processing" ? "Processing" : "Pending"}</div>
                            <span className={`vid-status ${v.status === "processing" ? "vs-processing" : v.status === "failed" ? "vs-failed" : "vs-pending"}`}>{v.status === "processing" ? <><span className="spin" style={{ width: 10, height: 10, borderColor: "rgba(146,64,14,.3)", borderTopColor: "#92400e" }} /> Processing</> : v.status}</span>
                          </>}
                        </div>
                      </div>;
                    })}
                  </div>}
                </div>
              </>;
            })()}

            {/* ═══ COMPARE BATCHES ═════════════════════════════════ */}
            {sec === "compare" && (() => {
              const cols = [cmpBatchA, cmpBatchB].map(id => {
                const batch = batchById(id);
                const vid = latestVideoForBatch(id);
                const ageDays = batch && vid ? daysBetween(batch.plantingDate, vid.capturedAt) : null;
                return { id, batch, vid, ageDays };
              });
              const [A, B] = cols;
              const hsA = A.vid?.aggregate?.health_score, hsB = B.vid?.aggregate?.health_score;
              const hsDelta = (hsA != null && hsB != null) ? hsA - hsB : null;
              return <>
                <div className="cd" style={{ marginBottom: 20 }}>
                  <div className="cd-h"><div className="cd-t">Select Batches to Compare</div></div>
                  <div className="fr">
                    <div className="fg"><label className="lb">Batch A</label>
                      <select className="sel" value={cmpBatchA} onChange={e => setCmpBatchA(e.target.value)}>{SEED_BATCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                    </div>
                    <div className="fg"><label className="lb">Batch B</label>
                      <select className="sel" value={cmpBatchB} onChange={e => setCmpBatchB(e.target.value)}>{SEED_BATCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                    </div>
                  </div>
                </div>

                <div className="cmp-grid">
                  {cols.map((c, ci) => (
                    <div key={ci} className="cmp-col">
                      <div className="cmp-head">
                        <div style={{ fontFamily: "var(--fd)", fontSize: 16, fontWeight: 700, color: "var(--e8)" }}>{c.batch?.label || "Batch"}</div>
                        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>{c.batch?.fieldName} | planted {c.batch ? new Date(c.batch.plantingDate).toLocaleDateString("en-ZW", { day: "numeric", month: "short", year: "numeric" }) : "?"}</div>
                      </div>
                      {c.vid ? <>
                        {repFrame(c.vid)?.src ? <img className="cmp-thumb" src={repFrame(c.vid).src} alt="" /> : <div className="cmp-thumb-ph"><PlaceholderImg type="growth" size={150} /></div>}
                        <div className="cmp-metric"><span style={{ color: "var(--tm)" }}>Age at latest walk</span><strong>{c.ageDays} days</strong></div>
                        <div className="cmp-metric"><span style={{ color: "var(--tm)" }}>Growth stage</span><strong>{c.vid.aggregate?.growth_stage}</strong></div>
                        <div className="cmp-metric"><span style={{ color: "var(--tm)" }}>Health score</span><span className="hbar-row" style={{ width: 130 }}><span className="hbar" style={{ flex: 1 }}><span className="hbar-fill" style={{ display: "block", width: `${c.vid.aggregate?.health_score}%`, background: healthColor(c.vid.aggregate?.health_score) }} /></span><span className="hbar-val" style={{ color: healthColor(c.vid.aggregate?.health_score) }}>{c.vid.aggregate?.health_score}</span></span></div>
                        <div className="cmp-metric"><span style={{ color: "var(--tm)" }}>Plant density</span><strong style={{ fontSize: 12, textAlign: "right", maxWidth: 160 }}>{c.vid.analyses?.[0]?.plant_density || "n/a"}</strong></div>
                        <div className="cmp-metric"><span style={{ color: "var(--tm)" }}>Weed pressure</span><strong style={{ textTransform: "capitalize" }}>{c.vid.aggregate?.weedPressure}</strong></div>
                        <div style={{ padding: "12px 16px" }}>
                          <div className="sl" style={{ marginBottom: 6 }}>Flags</div>
                          {(c.vid.aggregate?.flags || []).length === 0 && (c.vid.aggregate?.pests || []).length === 0 && <span style={{ fontSize: 12, color: "var(--g6)" }}>None flagged</span>}
                          {(c.vid.aggregate?.flags || []).slice(0, 4).map((f, i) => <span key={i} className={`flag-pill flag-${f.severity || "low"}`}>{(f.type || "flag").replace(/_/g, " ")}</span>)}
                          {(c.vid.aggregate?.pests || []).slice(0, 3).map((p, i) => <span key={`p${i}`} className="flag-pill flag-moderate"><I.Bug /> {p.label}</span>)}
                        </div>
                        <div style={{ padding: "0 16px 14px", fontSize: 12, color: "var(--ts)" }}>{c.vid.aggregate?.notes}</div>
                      </> : <p style={{ textAlign: "center", color: "var(--tm)", padding: 32, fontSize: 13 }}>No analysed video for this batch yet.</p>}
                    </div>
                  ))}
                </div>

                {hsDelta !== null && <div className="cmp-delta">
                  <div style={{ fontFamily: "var(--fd)", fontSize: 16, fontWeight: 700, color: "var(--g8)", marginBottom: 6 }}>
                    {hsDelta === 0 ? "Both batches are level on health" : `${(hsDelta > 0 ? A.batch?.label : B.batch?.label)} is ahead by ${Math.abs(hsDelta)} health points`}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ts)", lineHeight: 1.6 }}>
                    {A.ageDays != null && B.ageDays != null && Math.abs(A.ageDays - B.ageDays) > 5
                      ? `Note the age gap: Batch A's latest walk is at ${A.ageDays} days versus ${B.ageDays} days for Batch B, so read the comparison at matched age where possible.`
                      : "Both walks are at a similar crop age, so this is a fair like-for-like read."}
                    {hsDelta !== 0 && ` Investigate the lagging batch for the flags shown above (commonly irrigation uniformity, nitrogen timing, or weed competition) before the gap compounds.`}
                  </div>
                </div>}
              </>;
            })()}

          </div>
        </main>

        {/* FAB */}
        <div className="fab">
          {fabOpen && <>
            <button className="fab-btn fab-sec" onClick={() => { setFabOpen(false); setWalkMode("video"); nav("fieldwalk"); }} style={{ position: "relative" }}>
              <span className="fab-label">Record Video Walk</span><I.Video />
            </button>
            <button className="fab-btn fab-sec" onClick={() => { setFabOpen(false); nav("fieldwalk"); }} style={{ position: "relative" }}>
              <span className="fab-label">Field Walk + Camera</span><I.Walk />
            </button>
            <button className="fab-btn fab-sec" onClick={() => { setFabOpen(false); nav("pest"); }} style={{ position: "relative" }}>
              <span className="fab-label">Snap and Identify Pest</span><I.Bug />
            </button>
            <button className="fab-btn fab-sec" onClick={() => { setFabOpen(false); nav("media"); }} style={{ position: "relative" }}>
              <span className="fab-label">Photo Gallery</span><I.Gallery />
            </button>
          </>}
          <button className="fab-btn fab-main" onClick={() => setFabOpen(!fabOpen)} style={{ transform: fabOpen ? "rotate(45deg)" : "none", transition: "transform .2s" }}>
            <I.Plus />
          </button>
        </div>

        {/* Lightbox */}
        {lightbox && (
          <div className="lbox" onClick={() => setLightbox(null)}>
            <button className="lbox-close" onClick={() => setLightbox(null)}><I.X /></button>
            <div onClick={e => e.stopPropagation()}>
              {lightbox.src ? <img src={lightbox.src} alt="" /> : <div style={{ width: 400, height: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.1)", borderRadius: "var(--rl)" }}><PlaceholderImg type={lightbox.type || "general"} size={200} /></div>}
              <div className="lbox-info">
                <h4>{lightbox.field || "Farm Photo"}</h4>
                <p>{lightbox.note || ""}</p>
                {lightbox.date && <p style={{ marginTop: 4 }}>{lightbox.date}</p>}
                <div className="lbox-actions">
                  {lightbox.src && <button className="bt bg bsm" onClick={() => { setPestImage(lightbox.src); setPestDesc(lightbox.note || ""); setLightbox(null); nav("pest"); }}><I.Zap /> Identify Pest</button>}
                  <button className="bt bs bsm" onClick={() => setLightbox(null)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Expanded video: per-frame analysis */}
        {expandedVideo && (() => {
          const v = expandedVideo;
          const agg = v.aggregate || {};
          const frames = v.frames || [];
          return (
            <div className="lbox" onClick={() => setExpandedVideo(null)} style={{ alignItems: "stretch", justifyContent: "flex-start", overflowY: "auto" }}>
              <button className="lbox-close" onClick={() => setExpandedVideo(null)}><I.X /></button>
              <div onClick={e => e.stopPropagation()} style={{ maxWidth: 920, width: "100%", margin: "48px auto 32px" }}>
                <div className="cd">
                  <div className="cd-h">
                    <div>
                      <div className="cd-t">{v.fieldName} | {CROP_DATABASE[v.crop]?.name || v.crop}</div>
                      <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
                        {new Date(v.capturedAt).toLocaleDateString("en-ZW", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                        {v.batchId ? ` | ${batchById(v.batchId)?.label}` : ""} | {v.durationSeconds || 0}s | source: {String(v.source || "").replace(/_/g, " ")}
                      </div>
                    </div>
                    <span className="vid-status vs-analyzed"><I.Check /> Analysed</span>
                  </div>

                  {/* Aggregate summary */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, marginBottom: 18 }}>
                    <div><div className="sl">Growth stage</div><div style={{ fontFamily: "var(--fd)", fontSize: 20, fontWeight: 700, color: "var(--e8)" }}>{agg.growth_stage || "n/a"}</div></div>
                    <div><div className="sl">Health score</div>
                      <div className="hbar-row"><div className="hbar" style={{ flex: 1 }}><div className="hbar-fill" style={{ width: `${agg.health_score || 0}%`, background: healthColor(agg.health_score || 0) }} /></div><span className="hbar-val" style={{ color: healthColor(agg.health_score || 0) }}>{agg.health_score || 0}</span></div>
                    </div>
                    <div><div className="sl">Weed pressure</div><div style={{ fontFamily: "var(--fd)", fontSize: 20, fontWeight: 700, color: "var(--e8)", textTransform: "capitalize" }}>{agg.weedPressure || "n/a"}</div></div>
                  </div>
                  {agg.notes && <p style={{ fontSize: 14, color: "var(--ts)", marginBottom: 8, lineHeight: 1.6 }}>{agg.notes}</p>}
                  <div style={{ marginBottom: 18 }}>
                    {(agg.flags || []).map((f, i) => <span key={i} className={`flag-pill flag-${f.severity || "low"}`} title={f.note || ""}>{(f.type || "flag").replace(/_/g, " ")} ({f.severity || "low"})</span>)}
                    {(agg.pests || []).map((p, i) => <span key={`p${i}`} className="flag-pill flag-moderate" title={p.note || ""}><I.Bug /> {p.label}</span>)}
                  </div>

                  {/* Frames */}
                  <div className="ts-h">Sampled frames ({frames.length})</div>
                  <div className="frame-grid">
                    {frames.map(f => {
                      const a = (v.analyses || []).find(x => x.frameIndex === f.index);
                      return <div key={f.index} className="frame-card">
                        {f.src ? <img className="fimg" src={f.src} alt="" onClick={() => setLightbox({ src: f.src, field: v.fieldName, note: a?.notes || "", date: new Date(v.capturedAt).toLocaleDateString() })} /> : <div className="fimg-ph"><PlaceholderImg type="growth" size={110} /></div>}
                        <div className="frame-meta">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "var(--tm)" }}>{f.t}s</span>
                            {a && <span className="hbar-val" style={{ color: healthColor(a.health_score) }}>{a.health_score}</span>}
                          </div>
                          {a && <>
                            <div style={{ fontWeight: 600, color: "var(--e7)", margin: "3px 0" }}>{a.growth_stage}</div>
                            <div className="hbar" style={{ marginBottom: 6 }}><div className="hbar-fill" style={{ width: `${a.health_score}%`, background: healthColor(a.health_score) }} /></div>
                            {(a.health_flags || []).slice(0, 2).map((fl, i) => <span key={i} className={`flag-pill flag-${fl.severity || "low"}`}>{(fl.type || "flag").replace(/_/g, " ")}</span>)}
                            {(a.pest_disease_signs || []).slice(0, 1).map((p, i) => <span key={`pp${i}`} className="flag-pill flag-moderate">{p.label}</span>)}
                            {a.notes && <div style={{ fontSize: 11, color: "var(--ts)", marginTop: 5, lineHeight: 1.4 }}>{a.notes}</div>}
                          </>}
                          {!a && <div style={{ fontSize: 11, color: "var(--tm)" }}>No analysis for this frame.</div>}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {sbOpen && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 99 }} onClick={() => setSbOpen(false)} />}
      </div>
    </>
  );
}
