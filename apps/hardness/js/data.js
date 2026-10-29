// Hardness data. Mohs values are scratch-test rankings (often given as
// ranges); Vickers (HV) values are typical, in kgf/mm² (×0.0098 = GPa).
// Sources: standard mineralogy tables, the commonly cited "hardness of the
// elements" table, ASTM E140 approximations for steels, and literature on
// superhard materials. Treat everything as typical, not specified.
//
// [name, category, mohs low, mohs high, HV typical (or null), note]
var MATERIALS = [
  // Mohs reference minerals
  ["Talc", "Mohs reference", 1, 1, 2, "Softest reference mineral; greasy feel, scratched by a fingernail."],
  ["Gypsum", "Mohs reference", 2, 2, 50, "Scratched by a fingernail. Drywall and plaster."],
  ["Calcite", "Mohs reference", 3, 3, 120, "Scratched by a copper coin. Limestone, marble, chalk."],
  ["Fluorite", "Mohs reference", 4, 4, 190, "Scratched easily by a steel knife."],
  ["Apatite", "Mohs reference", 5, 5, 540, "Steel knife scratches it with effort. Same mineral family as tooth enamel."],
  ["Orthoclase feldspar", "Mohs reference", 6, 6, 800, "Scratches window glass."],
  ["Quartz", "Mohs reference", 7, 7, 1200, "Scratches glass and steel easily. Most sand is quartz."],
  ["Topaz", "Mohs reference", 8, 8, 1650, "Scratches quartz."],
  ["Corundum (sapphire, ruby)", "Mohs reference", 9, 9, 2100, "Second only to diamond among common minerals."],
  ["Diamond", "Mohs reference", 10, 10, 9000, "Hardest natural material (HV roughly 7000–10000 depending on direction)."],

  // Everyday scratch tests
  ["Fingernail", "Everyday tests", 2.5, 2.5, null, "Scratches gypsum and talc."],
  ["Copper coin (pure copper)", "Everyday tests", 3, 3, null, "Scratches calcite."],
  ["Iron nail", "Everyday tests", 4.5, 4.5, null, "Typical mild-steel nail."],
  ["Window glass", "Everyday tests", 5.5, 5.5, 550, "Scratched by quartz and feldspar."],
  ["Steel knife blade", "Everyday tests", 5.5, 6.5, null, "Depends strongly on the steel and its heat treatment."],
  ["Steel file (hardened)", "Everyday tests", 6.5, 7, null, "Used to test minerals around 6.5."],
  ["Porcelain streak plate", "Everyday tests", 6.5, 7, null, "Unglazed porcelain; harder minerals leave no streak."],

  // Gems
  ["Pearl (nacre)", "Gems", 2.5, 4.5, null, "Aragonite platelets in protein: soft and easily scratched."],
  ["Amber", "Gems", 2, 2.5, null, "Fossil tree resin."],
  ["Coral", "Gems", 3, 4, null, "Calcium carbonate skeletons."],
  ["Malachite", "Gems", 3.5, 4, null, "Copper carbonate."],
  ["Lapis lazuli", "Gems", 5, 5.5, null, "A rock, mostly lazurite."],
  ["Turquoise", "Gems", 5, 6, null, "Often stabilized with resin."],
  ["Opal", "Gems", 5.5, 6.5, null, "Contains water; can crack if it dries out."],
  ["Moonstone (feldspar)", "Gems", 6, 6.5, null, ""],
  ["Peridot (olivine)", "Gems", 6.5, 7, null, ""],
  ["Nephrite jade", "Gems", 6, 6.5, null, "Very tough (resists breaking) though not very hard."],
  ["Jadeite jade", "Gems", 6.5, 7, null, ""],
  ["Garnet", "Gems", 6.5, 7.5, null, "Also used as an abrasive (garnet paper)."],
  ["Tourmaline", "Gems", 7, 7.5, null, ""],
  ["Emerald / aquamarine (beryl)", "Gems", 7.5, 8, null, ""],
  ["Spinel", "Gems", 8, 8, null, ""],
  ["Chrysoberyl (incl. alexandrite)", "Gems", 8.5, 8.5, null, ""],
  ["Cubic zirconia (ZrO2)", "Gems", 8, 8.5, null, "Common diamond simulant."],
  ["Moissanite (SiC)", "Gems", 9.25, 9.5, null, "Diamond simulant; also an abrasive."],

  // Rocks and building materials
  ["Chalk", "Rocks & building", 1, 2, null, "Very fine calcite."],
  ["Marble", "Rocks & building", 3, 4, null, "Recrystallized calcite/dolomite."],
  ["Dolomite", "Rocks & building", 3.5, 4, null, ""],
  ["Obsidian", "Rocks & building", 5, 5.5, null, "Volcanic glass."],
  ["Concrete (cured)", "Rocks & building", 5, 6, null, "Aggregate is usually harder than the cement paste."],
  ["Granite", "Rocks & building", 6, 7, null, "Mix of quartz and feldspar grains."],
  ["Slate", "Rocks & building", 3, 4, null, ""],
  ["Brick (fired clay)", "Rocks & building", 3, 5, null, "Varies widely with firing."],

  // Pure elements (commonly cited values)
  ["Caesium (Cs)", "Elements (pure)", 0.2, 0.2, null, "Melts at 28.5 °C."],
  ["Rubidium (Rb)", "Elements (pure)", 0.3, 0.3, null, ""],
  ["Potassium (K)", "Elements (pure)", 0.4, 0.4, null, "Cuts like cold butter."],
  ["Sodium (Na)", "Elements (pure)", 0.5, 0.5, null, ""],
  ["Phosphorus (white)", "Elements (pure)", 0.5, 0.5, null, ""],
  ["Lithium (Li)", "Elements (pure)", 0.6, 0.6, null, ""],
  ["Graphite (carbon)", "Elements (pure)", 1, 2, null, "Same element as diamond: bonding makes the difference."],
  ["Indium (In)", "Elements (pure)", 1.2, 1.2, null, ""],
  ["Thallium (Tl)", "Elements (pure)", 1.2, 1.2, null, ""],
  ["Barium (Ba)", "Elements (pure)", 1.25, 1.25, null, ""],
  ["Gallium (Ga)", "Elements (pure)", 1.5, 1.5, null, "Melts in the hand (29.8 °C)."],
  ["Strontium (Sr)", "Elements (pure)", 1.5, 1.5, null, ""],
  ["Tin (Sn)", "Elements (pure)", 1.5, 1.5, null, ""],
  ["Lead (Pb)", "Elements (pure)", 1.5, 1.5, null, ""],
  ["Mercury (Hg, frozen)", "Elements (pure)", 1.5, 1.5, null, "Solid only below −38.8 °C."],
  ["Calcium (Ca)", "Elements (pure)", 1.75, 1.75, null, ""],
  ["Sulfur (S)", "Elements (pure)", 2, 2, null, ""],
  ["Selenium (Se)", "Elements (pure)", 2, 2, null, ""],
  ["Cadmium (Cd)", "Elements (pure)", 2, 2, null, ""],
  ["Tellurium (Te)", "Elements (pure)", 2.25, 2.25, null, ""],
  ["Bismuth (Bi)", "Elements (pure)", 2.25, 2.25, null, ""],
  ["Gold (Au)", "Elements (pure)", 2.5, 2.5, 25, "Pure gold is soft: jewelry gold is alloyed."],
  ["Silver (Ag)", "Elements (pure)", 2.5, 2.5, 25, ""],
  ["Zinc (Zn)", "Elements (pure)", 2.5, 2.5, null, ""],
  ["Magnesium (Mg)", "Elements (pure)", 2.5, 2.5, null, ""],
  ["Lanthanum (La)", "Elements (pure)", 2.5, 2.5, null, ""],
  ["Cerium (Ce)", "Elements (pure)", 2.5, 2.5, null, ""],
  ["Aluminium (Al)", "Elements (pure)", 2.75, 2.75, 20, "Pure Al is soft; alloys are much harder."],
  ["Copper (Cu)", "Elements (pure)", 3, 3, 50, "Annealed; cold work raises it."],
  ["Antimony (Sb)", "Elements (pure)", 3, 3, null, ""],
  ["Thorium (Th)", "Elements (pure)", 3, 3, null, ""],
  ["Platinum (Pt)", "Elements (pure)", 3.5, 3.5, 55, ""],
  ["Arsenic (As)", "Elements (pure)", 3.5, 3.5, null, ""],
  ["Iron (Fe)", "Elements (pure)", 4, 4, 70, "Pure iron; steels are much harder."],
  ["Nickel (Ni)", "Elements (pure)", 4, 4, null, ""],
  ["Palladium (Pd)", "Elements (pure)", 4.75, 4.75, null, ""],
  ["Cobalt (Co)", "Elements (pure)", 5, 5, null, ""],
  ["Zirconium (Zr)", "Elements (pure)", 5, 5, null, ""],
  ["Beryllium (Be)", "Elements (pure)", 5.5, 5.5, null, ""],
  ["Molybdenum (Mo)", "Elements (pure)", 5.5, 5.5, null, ""],
  ["Hafnium (Hf)", "Elements (pure)", 5.5, 5.5, null, ""],
  ["Titanium (Ti)", "Elements (pure)", 6, 6, null, ""],
  ["Manganese (Mn)", "Elements (pure)", 6, 6, null, "Brittle."],
  ["Germanium (Ge)", "Elements (pure)", 6, 6, null, ""],
  ["Niobium (Nb)", "Elements (pure)", 6, 6, null, ""],
  ["Rhodium (Rh)", "Elements (pure)", 6, 6, null, ""],
  ["Uranium (U)", "Elements (pure)", 6, 6, null, ""],
  ["Silicon (Si)", "Elements (pure)", 6.5, 6.5, null, ""],
  ["Ruthenium (Ru)", "Elements (pure)", 6.5, 6.5, null, ""],
  ["Tantalum (Ta)", "Elements (pure)", 6.5, 6.5, null, ""],
  ["Iridium (Ir)", "Elements (pure)", 6.5, 6.5, null, ""],
  ["Vanadium (V)", "Elements (pure)", 7, 7, null, ""],
  ["Osmium (Os)", "Elements (pure)", 7, 7, null, ""],
  ["Rhenium (Re)", "Elements (pure)", 7, 7, null, ""],
  ["Tungsten (W)", "Elements (pure)", 7.5, 7.5, null, ""],
  ["Chromium (Cr)", "Elements (pure)", 8.5, 8.5, null, "Hardest pure metal on the Mohs scale."],
  ["Boron (B)", "Elements (pure)", 9.5, 9.5, null, "Second-hardest element after carbon (diamond)."],

  // Alloys and steels (HV typical; Mohs approximate from hardness)
  ["Lead-tin solder", "Metals & alloys", 1.5, 2, null, ""],
  ["Brass (annealed)", "Metals & alloys", 3, 4, 100, ""],
  ["Bronze", "Metals & alloys", 3, 4, null, ""],
  ["Aluminium alloy 6061-T6", "Metals & alloys", 3, 3.5, 107, "Common extrusion alloy."],
  ["Aluminium alloy 7075-T6", "Metals & alloys", 3.5, 4, 175, "Aerospace alloy."],
  ["18k gold (75% Au)", "Metals & alloys", 3, 3.5, 140, ""],
  ["Sterling silver", "Metals & alloys", 3, 3.5, null, ""],
  ["Titanium Ti-6Al-4V", "Metals & alloys", 5.5, 6, 350, "Aerospace and implants."],
  ["Mild steel (1018, annealed)", "Steels", 4, 4.5, 130, "About 70 HRB."],
  ["Cast iron (gray)", "Steels", 4.5, 5, 210, ""],
  ["Stainless steel 304 (annealed)", "Steels", 5, 5.5, 200, "Work-hardens when machined or bent."],
  ["Stainless steel 316", "Steels", 5, 5.5, 210, ""],
  ["4140 steel (quenched & tempered)", "Steels", 5.5, 6, 320, "About 28–32 HRC."],
  ["Spring steel", "Steels", 6, 6.5, 480, "About 45–50 HRC."],
  ["Hardened knife steel (58–60 HRC)", "Steels", 6.5, 7, 680, "Typical kitchen/pocket knife."],
  ["52100 bearing steel (62 HRC)", "Steels", 7, 7, 750, ""],
  ["High-speed steel M2 (64 HRC)", "Steels", 7, 7.5, 830, "Keeps hardness up to about 600 °C ('red hardness')."],
  ["Manganese (Hadfield) steel, work-hardened", "Steels", 6.5, 7, 500, "Soft as cast; the surface hardens under impact."],
  ["Nitrided steel surface", "Steels", 7.5, 8, 1000, "Thin, very hard case."],

  // Ceramics and tool materials
  ["Hydroxyapatite (synthetic)", "Ceramics & tools", 5, 5, null, ""],
  ["Fused silica (quartz glass)", "Ceramics & tools", 5.5, 6.5, 600, ""],
  ["Borosilicate glass", "Ceramics & tools", 5.5, 6, 580, "Pyrex-type labware."],
  ["Gorilla-type glass (strengthened)", "Ceramics & tools", 6, 7, 650, "Phone screens scratch at around 6–7 (sand, Mohs 7, scratches them)."],
  ["Porcelain / stoneware", "Ceramics & tools", 6, 7, null, ""],
  ["Zirconia ceramic (Y-TZP)", "Ceramics & tools", 8, 8.5, 1250, "Ceramic knives, dental crowns."],
  ["Alumina ceramic (Al2O3)", "Ceramics & tools", 9, 9, 1600, "Same compound as sapphire."],
  ["Sapphire crystal (watch glass)", "Ceramics & tools", 9, 9, 2100, ""],
  ["Silicon nitride (Si3N4)", "Ceramics & tools", 8.5, 9, 1600, "Bearing balls, cutting inserts."],
  ["Tungsten carbide (cemented, WC-Co)", "Ceramics & tools", 8.5, 9, 1600, "Drill bits and cutting inserts; keeps hardness to ~1000 °C."],
  ["Titanium carbide (TiC)", "Ceramics & tools", 9, 9.5, 3000, ""],
  ["Silicon carbide (SiC)", "Ceramics & tools", 9.25, 9.5, 2600, "Abrasive grit (carborundum)."],
  ["Boron carbide (B4C)", "Ceramics & tools", 9.5, 9.75, 3000, "Body armor plates, blast nozzles."],
  ["Cubic boron nitride (cBN)", "Superhard", 9.5, 10, 4800, "Second-hardest bulk material in common use; machines hardened steel, which diamond can't (it reacts with iron)."],
  ["Polycrystalline diamond (PCD)", "Superhard", 10, 10, 8000, "Sintered diamond grains: tougher than single crystals."],
  ["Nanotwinned cubic boron nitride", "Superhard", 10, 10, 10000, "Measured HV around 100 GPa (2013): harder than single-crystal diamond in some tests."],
  ["Nanotwinned diamond", "Superhard", 10, 10, 20000, "Measured HV around 200 GPa (2014): the hardest material measured so far, about twice natural diamond."],
  ["Aggregated diamond nanorods (ADNR)", "Superhard", 10, 10, null, "Reported to scratch diamond; the least compressible known material."],
  ["Lonsdaleite (hexagonal diamond)", "Superhard", 10, 10, null, "Simulations predict ~58% harder than diamond; real (impure, tiny) samples have not confirmed it."],
  ["Wurtzite boron nitride", "Superhard", 10, 10, null, "Predicted by simulation to exceed diamond under load; not confirmed in bulk."],

  // Biological crystals and tissues
  ["Tooth enamel", "Biological", 5, 5, 350, "~96% hydroxyapatite; the hardest substance in the human body."],
  ["Dentin", "Biological", 3, 4, 60, "Under the enamel; more protein, softer."],
  ["Bone", "Biological", 3, 3.5, 50, "Hydroxyapatite in collagen: hard but tough."],
  ["Seashell (aragonite/calcite)", "Biological", 3, 4, null, ""],
  ["Eggshell (calcite)", "Biological", 3, 3, null, ""],
  ["Kidney stone: calcium oxalate (whewellite)", "Biological", 2.5, 3, null, "The most common kidney-stone mineral."],
  ["Kidney stone: struvite", "Biological", 2, 2, null, "Magnesium ammonium phosphate; infection stones."],
  ["Kidney stone: uric acid", "Biological", 2, 2.5, null, "Values for biological stones are approximate."],
  ["Gallstone (cholesterol)", "Biological", 1, 2, null, "Soft, waxy crystals; approximate."],
  ["Chiton teeth (magnetite)", "Biological", 6, 6, null, "Mollusc teeth capped with magnetite: among the hardest biominerals."],
  ["Sea-urchin tooth (calcite)", "Biological", 3.5, 4, null, "Grinds rock using magnesium-rich calcite."],

  // Ice and frozen materials
  ["Ice at 0 °C", "Ice & cold", 1.5, 2, null, "Soft near melting."],
  ["Ice at −40 °C", "Ice & cold", 4, 4, null, "Approximate; ice hardens a lot as it gets colder."],
  ["Ice at −78 °C", "Ice & cold", 6, 6, null, "Approximate (dry-ice temperature)."],
  ["Dry ice (solid CO2)", "Ice & cold", 2, 2, null, "Approximate."],

  // Everyday materials
  ["Rock salt (halite)", "Everyday", 2, 2.5, null, "Table salt crystals."],
  ["Sugar crystals (sucrose)", "Everyday", 2, 2.5, null, "Approximate."],
  ["Acrylic (PMMA)", "Everyday", 2, 3, 20, "Shore D ~90; scratches much more easily than glass."],
  ["Polycarbonate", "Everyday", 1.5, 2.5, null, "Shore D ~80–85."],
  ["Hard rubber / hard plastics", "Everyday", 1, 2, null, "Use Shore hardness for these (see Converter)."]
];

// Mohs reference minerals vs indentation hardness (typical values) for
// rough interpolation. Mohs is an ordinal scale: the steps aren't equal.
var MOHS_REF = [
  // mohs, Knoop (HK), Vickers (HV)
  [1, 1, 2], [2, 32, 50], [3, 135, 120], [4, 163, 190], [5, 430, 540], [6, 560, 800], [7, 820, 1200], [8, 1340, 1650], [9, 2100, 2100], [10, 7000, 9000]
];

// Approximate equivalents for non-austenitic steels (after ASTM E140).
// HRC, HV, HB (tungsten-carbide ball), tensile MPa (≈ 3.45 × HB)
var STEEL_TABLE = [
  [68, 940, null], [66, 865, null], [65, 832, null], [64, 800, null], [62, 746, null], [60, 697, null], [58, 653, null],
  [56, 613, null], [55, 595, null], [54, 577, null], [52, 544, 500], [50, 513, 481], [48, 484, 456], [46, 458, 432],
  [45, 446, 421], [44, 434, 409], [42, 412, 390], [40, 392, 371], [38, 372, 353], [36, 354, 336], [35, 345, 327],
  [34, 336, 319], [32, 318, 301], [30, 302, 286], [28, 286, 271], [26, 272, 258], [25, 266, 253], [24, 260, 247],
  [22, 248, 237], [20, 238, 226]
];
// HRB for softer steels: HRB, HV, HB
var HRB_TABLE = [[100, 240, 228], [98, 228, 216], [96, 216, 205], [95, 210, 199], [94, 205, 195], [92, 195, 185], [90, 185, 176], [88, 176, 167],
  [86, 169, 160], [85, 165, 156], [84, 162, 152], [82, 156, 146], [80, 150, 141], [75, 137, 128], [70, 125, 116], [65, 116, 107], [60, 107, 100]];

// Approximate Shore A ↔ Shore D (durometers on different indenters;
// conversion is empirical and only rough).
var SHORE_AD = [[30, 6], [40, 10], [50, 12], [60, 15], [70, 22], [80, 29], [85, 33], [90, 39], [95, 46], [98, 58], [100, 70]];

var TEMPERATURE_NOTES = [
  ["Ice", "About 1.5–2 near 0 °C, about 4 at −40 °C and about 6 at −78 °C (approximate). Glacier ice at its base is soft; polar ice at −50 °C can scratch feldspar."],
  ["Steels (tempering)", "Hardened steel loses hardness if heated above its tempering temperature (often 150–600 °C): a knife blade softened by a grinder overheating ('blued') is ruined."],
  ["High-speed steel", "Keeps most of its hardness up to about 600 °C ('red hardness'), which is why it cuts at speeds that soften carbon steel."],
  ["Tungsten carbide", "Retains high hardness to roughly 800–1000 °C; used for high-speed machining."],
  ["Ceramics (alumina, SiC, cBN)", "Lose relatively little hardness up to 1000 °C+; cBN is used to machine hardened steel hot."],
  ["Diamond", "Softens at high temperature and burns in air from about 700–800 °C; it also reacts with iron when hot, so it isn't used to cut steel."],
  ["Metals in general", "Hardness falls as temperature approaches the melting point (hot forging). Near absolute zero most metals get harder but some (like tin) become brittle."],
  ["Mercury and gallium", "Mercury is only solid below −38.8 °C (Mohs ~1.5); gallium melts at 29.8 °C, so it's solid in a cool room and liquid in your hand."],
  ["Polymers", "Shore hardness drops with heat and rises sharply when cold; rubber can turn glassy and brittle below its glass-transition temperature."]
];
