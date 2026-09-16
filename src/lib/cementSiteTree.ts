/**
 * HBM Nigeria site hierarchy for the global Sites dropdown (SiteSelector).
 *
 * Structure mirrors the MiX organisation tree (Cement East/North/West, Customer
 * Assets, Quarry, Inbound, Ready Mix, Light Vehicles, Non-Ops, …).
 *
 * Matching rules (verified against public/sites.json):
 *  - Region / depot / ops groups → vehicle `zone`
 *  - Transporters / leaves inside a shared zone (e.g. DD WEST → TRULUCK) → `site`
 *  - Pure branch nodes (no `match`) exist only for collapsible grouping
 */

export type SiteMatchField = 'zone' | 'site';

export interface SiteTreeNode {
  key: string;
  label: string;
  /** Matches a real MiX value directly against this node (optional for pure branch nodes). */
  match?: RegExp;
  /** Which vehicle field `match` is tested against. Defaults to 'zone'. */
  field?: SiteMatchField;
  children?: SiteTreeNode[];
}

export interface SiteOption { key: string; label: string; count: number }

function z(key: string, label: string, match: RegExp, children?: SiteTreeNode[]): SiteTreeNode {
  return { key, label, match, field: 'zone', children };
}

function s(key: string, label: string, match: RegExp): SiteTreeNode {
  return { key, label, match, field: 'site' };
}

function b(key: string, label: string, children: SiteTreeNode[]): SiteTreeNode {
  return { key, label, children };
}

// ─── Cement › HBM East ───────────────────────────────────────────────────────

const bulkTankersEastChildren: SiteTreeNode[] = [
  s('abc-bulk-tankers', 'ABC Bulk Tankers', /^ABC\s*Bulk\s*Tankers$/i),
  s('fundamental-choice', 'FUNDAMENTAL CHOICE', /^FUNDAMENTAL\s*CHOICE$/i),
  s('geoman-east-bulk', 'GeomanEast Bulk', /GeomanEast\s*Bulk/i),
  s('iquasu-bulk', 'Iquasu Bulk', /^Iquasu\s*Bulk$/i),
  s('joza-bulk', 'JOZA Bulk', /^JOZA\s*Bulk$/i),
  s('mack-chagal-bulk', 'Mack Chagal Bulk', /Mack\s*Chagal\s*Bulk/i),
  s('swiftprosper', 'SWIFTPROSPER', /^SWIFTPROSPER$/i),
  s('tetralog-bulk', 'Tetralog BULK', /^Tetralog\s*BULK$/i),
  s('truluck-bulk-east', 'TRULUCK BULK EAST', /^TRULUCK\s*BULK\s*EAST$/i),
  s('whitesoul-bulk-tanker', 'WhiteSoul Bulk Tanker', /WhiteSoul\s*Bulk\s*Tanker/i),
  s('zudac-ltd', 'ZUDAC LTD', /^ZUDAC\s*LTD$/i),
];

const eastOpsTransporters: SiteTreeNode[] = [
  s('bhn-ewekoro-east-ops', 'BHN EWEKORO EAST OPS', /BHN\s*EWEKORO\s*EAST\s*OPS/i),
  s('bufa-investment', 'Bufa Investment', /^Bufa\s*Investment$/i),
  s('ecologique-east-op', 'ECOLOGIQUE EAST OP', /ECOLOGIQUE\s*EAST\s*OP/i),
  s('geoman-praise-east-ops', 'Geoman Praise East Ops', /Geoman\s*Praise\s*East\s*Ops/i),
  s('hst-east-op', 'HST East Op', /^HST\s*East\s*Op$/i),
  s('iquasu', 'IQUASU', /^IQUASU$/i),
  s('joza-east', 'JOZA', /^JOZA$/i),
  s('julius-ben', 'Julius Ben Construction', /Julius\s*Ben\s*Construction/i),
  s('kaysky-east-op', 'Kaysky East Operation', /Kaysky\s*East\s*Operation/i),
  s('marc-chagall', 'Marc Chagall', /^Marc\s*Chagall$/i),
  s('nofeji-empire', 'NOFEJI EMPIRE LTD', /NOFEJI\s*EMPIRE/i),
  s('rvl-east', 'RVL', /^RVL$/i),
  s('tetralog-east', 'TETRALOG', /^TETRALOG$/i),
  s('truluck-east-ops', 'Truluck East Ops', /Truluck\s*East\s*Ops/i),
  s('tsl-east', 'TSL EAST', /^TSL\s*EAST$/i),
  s('vicky-world', 'VICKY WORLD', /^VICKY\s*WORLD$/i),
  s('white-soul', 'WHITE SOUL', /^WHITE\s*SOUL$/i),
];

const mddTransportersChildren: SiteTreeNode[] = [
  s('alofarm', 'ALOFARM MULTIPURPOSE VENTURE', /ALOFARM/i),
  s('askon-progressive', 'ASKON PROGRESSIVE', /ASKON\s*PROGRESSIVE/i),
  s('batoframojo', 'BATOFRAMOJO E. ENTERPRISE', /BATOFRAMOJO/i),
  s('blessed-patiosa', 'BLESSED PATIOSA', /BLESSED\s*PATIOSA/i),
  s('c-c-umeh', 'C C UMEH', /^C\s*C\s*UMEH$/i),
  s('chico-trust', 'CHICO TRUST VENTURES NIG.', /CHICO\s*TRUST/i),
  s('chinasa', 'CHINASA', /^CHINASA$/i),
  s('chukwudi-sons', 'CHUKWUDI & SONS', /CHUKWUDI/i),
  s('chyken-sons', 'CHYKEN&SONS', /CHYKEN/i),
  s('deucheson', 'DEUCHESON ENTERP', /DEUCHESON/i),
  s('dona-dona', 'DONA DONA', /^DONA\s*DONA$/i),
  s('ekefire', 'EKEFIRE', /^EKEFIRE$/i),
  s('emma-bros', 'EMMA BROS', /EMMA\s*BROS/i),
  s('favour-global', 'FAVOUR GLOBAL', /FAVOUR\s*GLOBAL/i),
  s('festy-base', 'FESTY BASE', /^FESTY\s*BASE$/i),
  s('global-50-50', 'Global 50-50', /Global\s*50[-:]50$/i),
  s('global-snco', 'Global SNCO', /Global\s*SNCO/i),
  s('glojoesam-invest', 'GLOJOESAM INVEST. LTD', /GLOJOESAM\s*INVEST/i),
  s('goldpine-integrated', 'GOLDPINE INTEGRATED SERVICES', /^GOLDPINE\s*INTEGRATED\s*SERVICES$/i),
  s('great-agala', 'GREAT AGALA', /GREAT\s*AGALA/i),
  s('great-amobi-gas', 'Great Amobi Gas', /Great\s*Amobi\s*Gas/i),
  s('honosa', 'HONOSA ENTERPRISE', /HONOSA/i),
  s('i-c-odigwe', 'I C ODIGWE', /I\s*C\s*ODIGWE/i),
  s('infor-bros', 'Infor&Bros Nig.Ltd', /Infor\s*&?\s*Bros/i),
  s('izu-general', 'IZU GENERAL MERCHANDISE', /IZU\s*GENERAL/i),
  s('janny-sons', 'JANNY & SONS', /JANNY/i),
  s('jude-c-matthias', 'JUDE C. MATTHIAS', /JUDE\s*C\.?\s*MATTHIAS/i),
  s('keo-merch', 'KEO Merchandising company', /KEO\s*Merchandising/i),
  s('kpaksbuddy', 'KPAKSBUDDY', /KPAKSBUDDY/i),
  s('mcevans', 'MCEVANS', /^MCEVANS$/i),
  s('mega-uchechi', 'MEGA UCHECHI', /MEGA\s*UCHECHI/i),
  s('mekus-gamba', 'MEKUS GAMBA', /MEKUS\s*GAMBA/i),
  s('nils-nigeria', 'NILS NIGERIA ENT', /NILS\s*NIGERIA/i),
  s('obioma-mdd', 'OBIOMA', /^OBIOMA$/i),
  s('oge-rose', 'OGE ROSE ENTERPRISE', /OGE\s*ROSE/i),
  s('oral-trade', 'ORAL TRADE INTL.', /ORAL\s*TRADE/i),
  s('revolve-depot', 'REVOLVE DEPOT', /REVOLVE\s*DEPOT/i),
  s('rosent-jbc', 'ROSENT (JBC)', /ROSENT/i),
  s('tamark', 'TAMARK NIG LTD', /TAMARK/i),
  s('ubotex', 'UBOTEX', /^UBOTEX$/i),
  s('umekason', 'UMEKASON', /^UMEKASON$/i),
  s('unegbe-venture', 'UNEGBE VENTURE', /^UNEGBE\s*VENTURE$/i),
  s('vine-love-ugo', 'VINE LOVE UGO ENTERPRISES', /VINE\s*LOVE\s*UGO/i),
  s('vunic-global', 'VUNIC GLOBAL', /VUNIC\s*GLOBAL/i),
];

const spotHireEastChildren: SiteTreeNode[] = [
  s('chris-haulage', 'CHRIS HAULAGE', /CHRIS\s*HAULAGE/i),
  s('chris-sunny', 'CHRIS SUNNY', /CHRIS\s*SUNNY/i),
  s('cnc-marbel', 'CNC MARBEL ENTERPRISE', /CNC\s*MARBEL/i),
  s('emc-global', 'E.M.C GLOBAL VENTURES', /E\s*\.?\s*M\s*\.?\s*C\s*GLOBAL/i),
  s('fortune-dynamic', 'Fortune Dynamic Synergy', /Fortune\s*Dynamic/i),
  s('quatro-marine', 'QUATRO MARINE', /QUATRO\s*MARINE/i),
];

const hbmEastChildren: SiteTreeNode[] = [
  z('bulk-tankers-east', 'Bulk Tankers East', /^Bulk\s*Tankers\s*East$/i, bulkTankersEastChildren),
  z('dd-east', 'DD', /^DD$/i, [
    b('east-ops-transporters', 'East Ops Transporters', eastOpsTransporters),
    z('mdd-transporters', 'MDD Transporters', /^MDD\s*Transporters$/i, mddTransportersChildren),
    z('spot-hire-east', 'SPOT HIRE', /^SPOT\s*HIRE$/i, spotHireEastChildren),
  ]),
];

// ─── Cement › HBM North ──────────────────────────────────────────────────────

const northSpotHireChildren: SiteTreeNode[] = [
  s('ifeson', 'IFESON', /^IFESON$/i),
  s('usman-idris', 'USMAN IDRIS NIGERIA LTD', /USMAN\s*IDRIS/i),
];

const hbmNorthChildren: SiteTreeNode[] = [
  s('a-y-muhammed', 'A Y MUHAMMED', /^A\s*Y\s*MUHAMMED$/i),
  s('adl-transport', 'ADL Transport', /^ADL\s*Transport$/i),
  s('alamash', 'ALAMASH', /^ALAMASH$/i),
  s('alfadila', 'Alfadila', /^Alfadila$/i),
  s('alh-garba', 'ALH GARBA ZAGADA ZAGADA', /ALH\s*GARBA/i),
  s('almanas', 'Almanas', /^Almanas$/i),
  s('almau-ventures', 'ALMAU VENTURES NIG LTD', /ALMAU\s*VENTURES/i),
  s('ayb-gerengi', 'AYB GERENGI', /AYB\s*GERENGI/i),
  s('bhn-north-ops', 'BHN NORTH OPS', /BHN\s*NORTH\s*OPS/i),
  z('coal-trucks', 'COAL TRUCKS', /^Coal\s*Trucks$/i, [
    s('ashaka-coal-trucks', 'ASHAKACOALTRUCKS', /AshakaCoalTrucks|ASHAKA\s*COAL\s*TRUCKS/i),
  ]),
  s('dankasa', 'DANKASA INVESTMENT COMPANY', /DANKASA/i),
  s('kushimaga', 'KUSHIMAGA', /^KUSHIMAGA$/i),
  s('manu-mohammed', 'MANU MOHAMMED', /MANU\s*MOHAMMED/i),
  z('north-spot-hire', 'NORTH SPOT HIRE', /^NORTH\s*SPOT\s*HIRE$/i, northSpotHireChildren),
];

// ─── Cement › HBM West ───────────────────────────────────────────────────────

const ddWestChildren: SiteTreeNode[] = [
  s('aa-global', 'A A GLOBAL', /^A\s*A\s*GLOBAL$/i),
  s('abdlas', 'ABDLAS', /^ABDLAS$/i),
  s('big-multiquest', 'B.I.G Multiquest', /B\.?\s*I\.?\s*G\s*Multiquest/i),
  s('bhn-ewekoro', 'BHN EWEKORO', /^BHN\s*EWEKORO$/i),
  s('charterbridge', 'CHARTERBRIDGE VENTURES LOGISTIC LTD', /CHARTERBRIDGE\s*VENTURES\s*LOGISTIC/i),
  s('defrost', 'DEFROST', /^DEFROST$/i),
  s('deomat', 'DEOMAT', /^DEOMAT$/i),
  s('ebony', 'EBONY', /^EBONY$/i),
  s('ewecoop', 'EWECOOP', /^EWECOOP$/i),
  s('geoman-praise', 'GEOMAN PRAISE', /^GEOMAN\s*PRAISE$/i),
  s('hbm-transport', 'HBM TRANSPORT', /^HBM\s*TRANSPORT$/i),
  s('hst', 'HST', /^HST$/i),
  s('jbc-west', 'JBC West', /^JBC\s*West$/i),
  s('joza-west', 'JOZA West', /^JOZA\s*West$/i),
  s('kaysky-nig', 'KAYSKY NIGERIA LIMITED', /KAYSKY\s*NIGERIA\s*LIMITED/i),
  s('rem-bam', 'REM BAM', /^REM\s*BAM$/i),
  s('remo-commercial', 'Remo Commercial', /^Remo\s*Commercial$/i),
  s('sagamu-global', 'SAGAMU GLOBAL', /^SAGAMU\s*GLOBAL$/i),
  s('shiwatech', 'SHIWATECH', /^SHIWATECH$/i),
  s('truluck', 'TRULUCK', /^TRULUCK$/i),
  s('tsl-west', 'TSL WEST', /^TSL\s*WEST$/i),
];

const mddWestChildren: SiteTreeNode[] = [
  s('wow-abdlas', 'WOW/CD-ABDLAS', /^WOW\/CD-ABDLAS$/i),
  s('wow-big', 'WOW/CD-B.I.G Multiquest', /WOW\/CD-B\.?\s*I\.?\s*G\s*Multiquest/i),
  s('wow-charterbridge', 'WOW/CD-CHARTERBRIDGE VENTURES LOGISTICS LTD', /WOW\/CD-CHARTERBRIDGE/i),
  s('wow-defrost', 'WOW/CD-DEFROST', /WOW\/CD-DEFROST/i),
  s('wow-deomat', 'WOW/CD-DEOMAT', /WOW\/CD-DEOMAT/i),
  s('wow-geoman', 'WOW/CD-GEOMAN PRAISE & GLORY', /WOW\/CD-GEOMAN/i),
  s('wow-hst', 'WOW/CD-HST', /WOW\/CD-HST$/i),
  s('wow-joza-west', 'WOW/CD-JOZA WEST', /WOW\/CD-JOZA\s*WEST/i),
  s('wow-kaysky', 'WOW/CD-KAYSKY', /WOW\/CD-KAYSKY$/i),
  s('wow-lafarge-transport', 'WOW/CD-LAFARGE TRANSPORT', /WOW\/CD-LAFARGE\s*TRANSPORT/i),
  s('wow-olabisi-ebony', 'WOW/CD-OLABISI EBONY', /WOW\/CD-OLABISI\s*EBONY/i),
  s('wow-rembam', 'WOW/CD-REMBAM', /WOW\/CD-REMBAM$/i),
  s('wow-remo', 'WOW/CD-REMO COMMERCIAL', /WOW\/CD-REMO\s*COMMERCIAL/i),
  s('wow-shiwatech', 'WOW/CD-SHIWATECH', /WOW\/CD-SHIWATECH/i),
  s('wow-truluck', 'WOW/CD-TRULUCK', /WOW\/CD-TRULUCK$/i),
];

const spotHireWestChildren: SiteTreeNode[] = [
  s('tsl-west-sh', 'TSL WEST (SH)', /^TSL\s*WEST\s*\(SH\)$/i),
];

const westBulkTankerChildren: SiteTreeNode[] = [
  s('aa-global-bulk', 'A A Global - Bulk Tankers', /A\s*A\s*Global\s*-\s*Bulk\s*Tankers/i),
  s('adl-transport-west', 'ADL TRANSPORT WEST', /ADL\s*TRANSPORT\s*WEST/i),
  s('bhn-bulk-tankers', 'BHN - Bulk Tankers', /BHN\s*-\s*Bulk\s*Tankers/i),
  s('big-bulk', 'BIG Bulk', /^BIG\s*Bulk$/i),
  s('big-multiquest-bulk-east', 'BIG MULTIQUEST BULK EAST', /BIG\s*MULTIQUEST\s*BULK\s*EAST/i),
  s('charterbridge-bulk-east', 'CHARTERBRIDGE BULK EAST', /CHARTERBRIDGE\s*BULK\s*EAST/i),
  s('charterbridge-ventures-bulk', 'CHARTERBRIDGE VENTURES LOGISTIC LTD- BULK', /CHARTERBRIDGE\s*VENTURES.*BULK/i),
  s('hbm-transport-bulk', 'HBM TRANSPORT BULK', /HBM\s*TRANSPORT\s*BULK/i),
  s('kaysky-bulk', 'Kaysky Bulk', /^Kaysky\s*Bulk$/i),
  s('rembam-bulk-east', 'REMBAM BULK EAST', /^REMBAM\s*BULK\s*EAST$/i),
  s('rembam-bulk-tankers', 'REMBAM Bulk Tankers', /REMBAM\s*Bulk\s*Tankers/i),
  s('swift-prosper-west', 'SWIFT PROSPER NIG. LTD WEST. (SPR)', /SWIFT\s*PROSPER.*WEST/i),
  s('truluck-bulk-tankers', 'Truluck - Bulk tankers', /Truluck\s*-\s*Bulk\s*tankers/i),
];

const hbmWestChildren: SiteTreeNode[] = [
  z('dd-west', 'DD WEST', /^DD\s*WEST$/i, ddWestChildren),
  z('mdd-west', 'MDD', /^MDD$/i, mddWestChildren),
  z('spot-hire-west', 'SPOT HIRE WEST', /^SPOT\s*HIRE\s*WEST$/i, spotHireWestChildren),
  z('west-bulk-tanker', 'WEST BULK TANKER', /^WEST\s*BULK\s*TANKER$/i, westBulkTankerChildren),
];

const mixVisionPilotChildren: SiteTreeNode[] = [
  z('mix-vision-pilot-north', 'Mix Vision Pilot North', /^Mix\s*Vision\s*Pilot\s*North$/i, [
    s('ay-mohameed-ai', 'AY MOHAMEED Ai', /AY\s*MOHAMEED\s*Ai/i),
  ]),
  z('mix-vision-pilot-west', 'Mix Vision Pilot West', /^Mix\s*Vision\s*Pilot\s*West$/i, [
    s('ecologique-ai', 'Ecologique AI', /^Ecologique\s*AI$/i),
  ]),
];

const cementChildren: SiteTreeNode[] = [
  z('hbm-east', 'HBM - EAST', /^HBM\s*-\s*EAST$/i, hbmEastChildren),
  z('hbm-north', 'HBM - NORTH', /^HBM\s*-\s*NORTH$/i, hbmNorthChildren),
  z('hbm-west', 'HBM - WEST', /^HBM\s*-\s*WEST$/i, hbmWestChildren),
  z('ipi-installation-assets', 'IPI INSTALLATION ASSETS', /IPI\s*INSTALLATION\s*ASSETS|^IPI\s*INSTALL/i),
  z('mix-vision-pilot-cement', 'MiX Vision Pilot Cement', /^MiX\s*Vision\s*Pilot\s*Cement$/i, mixVisionPilotChildren),
];

// ─── HBM Customer Assets (depots) ────────────────────────────────────────────

function depot(key: string, label: string, zoneMatch: RegExp, sites: SiteTreeNode[]): SiteTreeNode {
  return z(key, label, zoneMatch, sites);
}

const customerAssetsChildren: SiteTreeNode[] = [
  depot('aba-depot', 'Aba Depot', /^Aba\s*Depot$/i, [
    s('glojoesam-inv-ltd', 'Glojoesam Investment Ltd', /Glojoesam\s*Investment\s*Ltd/i),
    s('irokosteel', 'Irokosteel International', /Irokosteel/i),
    s('mcevans-ventures', 'Mcevans Ventures Ltd', /Mcevans\s*Ventures/i),
  ]),
  depot('abeokuta-depot', 'Abeokuta Depot', /^Abeokuta\s*Depot$/i, [
    s('alh-abbey', 'Alh. Abbey Adebisi & Co.', /Abbey\s*Adebisi/i),
    s('bs-ventures', 'B&S VENTURES', /B\s*&\s*S\s*VENTURES/i),
    s('dateefat', 'Dateefat Nig. Ltd', /Dateefat/i),
    s('dove-cement', 'DOVE CEMENT', /DOVE\s*CEMENT/i),
    s('femyok', 'Femyok', /^Femyok$/i),
    s('oke-m-block', 'Oke M Block', /Oke\s*M\s*Block/i),
    s('posu', 'POSU', /^POSU$/i),
    s('vicross-ent', 'Vicross Ent', /^Vicross\s*Ent$/i),
    s('walterade', 'WALTERADE', /^WALTERADE$/i),
    s('yusfaith', 'Yusfaith', /^Yusfaith$/i),
  ]),
  depot('ado', 'Ado', /^Ado$/i, [
    s('ado-ekiti', 'Ado ekiti', /Ado\s*ekiti/i),
  ]),
  depot('agbara-depot', 'Agbara Depot', /^Agbara\s*Depot$/i, [
    s('temitope', 'TEMITOPE', /^TEMITOPE$/i),
    s('vihano', 'VIHANO', /^VIHANO$/i),
  ]),
  depot('ajah-depot', 'Ajah Depot', /^Ajah\s*Depot$/i, [
    s('alhaja-joke', 'Alhaja Joke Ojogbede', /Joke\s*Ojogbede/i),
    s('boatan', 'Boatan Ventures', /Boatan\s*Ventures/i),
    s('crystal-clear', 'CRYSTAL CLEAR', /CRYSTAL\s*CLEAR/i),
    s('double-d-unique', 'DOUBLE D Unique Ventures', /DOUBLE\s*D\s*Unique/i),
    s('haladex', 'Haladex Construction Limited', /Haladex/i),
    s('ifa', 'IFA', /^IFA$/i),
    s('kessayo', 'Kessayo International Ltd', /Kessayo/i),
    s('maseliz', 'Maseliz', /^Maseliz$/i),
    s('matib', 'Matib', /^Matib$/i),
    s('olasunkanmi', 'Olasunkanmi Global Enterprises', /Olasunkanmi/i),
    s('ugo', 'UGO', /^UGO$/i),
  ]),
  depot('akure', 'Akure', /^Akure$/i, [
    s('akure-depot', 'Akure Depot', /^Akure\s*Depot$/i),
  ]),
  depot('eleyele-depot', 'Eleyele Depot', /^Eleyele\s*Depot$/i, [
    s('abiodun-akinleye', 'Abiodun Akinleye', /Abiodun\s*Akinleye/i),
    s('ade-adewumi', 'Ade- Adewumi Nig. Ent.', /Ade-?\s*Adewun?mi/i),
    s('joseph-castles', 'Joseph Castles & Towers', /Joseph\s*Castles/i),
    s('la-lawal', 'L.A. Lawal Nigeria Enterprises', /L\.?\s*A\.?\s*Lawal/i),
    s('nokis-noble', 'Nokis Noble Company', /Nokis\s*Noble/i),
    s('omo-akin', 'Omo-Akin Megatop Global Ventures', /Omo-?Akin/i),
    s('soj-ent', 'S.O.J Ent.', /S\.?\s*O\.?\s*J\s*Ent/i),
    s('sandra-smith', 'Sandra & Smith Enterprises', /Sandra\s*&?\s*Smith/i),
    s('taokas', 'Taokas Multi-Concepts', /Taokas/i),
    s('tito-ventures', 'Tito Ventures', /^Tito\s*Ventures$/i),
    s('vicky-adeoye', 'Vicky Adeoye Ventures', /Vicky\s*Adeoye/i),
  ]),
  depot('enugu-depot', 'Enugu Depot', /^Enugu\s*Depot$/i, [
    s('avitrade', 'Avitrade Network Ltd', /Avitrade/i),
    s('gask-chida', 'Gask-Chida And Sons Ltd', /Gask-?Chida/i),
    s('joemachine', 'JOEMACHINE SERVICES', /JOEMACHINE/i),
    s('umekason-trading', 'Umekason Trading Stores', /Umekason\s*Trading/i),
    s('unegbe-ventures-ltd', 'Unegbe Ventures Ltd', /Unegbe\s*Ventures\s*Ltd/i),
  ]),
  z('ikorodu-depot', 'Ikorodu Depot', /^Ikorodu\s*Depot$/i),
  depot('iseyin', 'Iseyin', /^Iseyin$/i, [
    s('iseyin-leaf', 'Iseyin', /^Iseyin$/i),
  ]),
  depot('oregun-depot', 'Oregun Depot', /^Oregun\s*Depot$/i, [
    s('alabama-global', 'Alabama Global Ventures', /Alabama\s*Global/i),
    s('ebony-depot', 'Ebony - Depot', /Ebony\s*-\s*Depot/i),
    s('eji-ade', 'Eji-Ade Ent', /Eji-?Ade/i),
    s('emmanuel-adebayo', 'Emmanuel Adebayo', /Emmanuel\s*Adebayo/i),
    s('ibisola', 'Ibisola', /^Ibisola$/i),
    s('kazeezat', 'KAZEEZAT', /^KAZEEZAT$/i),
    s('moray-unique', 'Moray Unique Enterprises - Depot', /Moray\s*Unique/i),
    s('ola-adams', 'OLA ADAMS', /OLA\s*ADAMS/i),
    s('tai-dem', 'TAI-DEM & SONS', /TAI-?DEM/i),
    s('timpalas', 'TIMPALAS AGRO ALLIED VENTURES', /TIMPALAS/i),
    s('tridac', 'TRIDAC ENTERPRISE', /TRIDAC/i),
  ]),
  depot('oshogbo-depot', 'Oshogbo Depot', /^Oshogbo\s*Depot$/i, [
    s('oshogbo-depot-leaf', 'Oshogbo Depot', /Os[h]?ogbo\s*Depot/i),
  ]),
  depot('owerri-depot', 'Owerri Depot', /^Owerri\s*Depot$/i, [
    s('davidson-global', 'Davidson Global Nig Ent', /Davidson\s*Global/i),
    s('global-5050-concept', 'Global 50:50 Concept Nig. Ltd', /Global\s*50:50\s*Concept/i),
    s('owerri-assets', 'Owerri Assets', /^Owerri\s*Assets$/i),
    s('vine-lov-ugo', 'Vine Lov Ugo Enterprises', /Vine\s*Lov\s*Ugo/i),
  ]),
  depot('ph-depot', 'PH Depot', /^PH\s*Depot$/i, [
    s('goldpine-depot', 'Goldpine Integrated Services - Depot', /Goldpine\s*Integrated\s*Services\s*-\s*Depot/i),
    s('goodluck-nwaneri', 'Goodluck O. Nwaneri And Sons', /Goodluck\s*O\.?\s*Nwaneri/i),
    s('sammyking', 'Sammyking Building Material', /Sammyking/i),
    s('shamah-junex', 'Shamah-Junex Ltd', /Shamah-?Junex/i),
  ]),
  depot('uyo-depot', 'Uyo Depot', /^Uyo\s*Depot$/i, [
    s('becuk', 'Becuk Investment', /Becuk/i),
    s('festy-base-ent', 'Festy Base Ent', /Festy\s*Base\s*Ent/i),
    s('nonea', 'Nonea Integrated Services Nigeria', /Nonea/i),
    s('ubotex-depot', 'Ubotex Depot', /Ubotex\s*Depot/i),
  ]),
];

// ─── Other top-level org groups ──────────────────────────────────────────────

const quarryChildren: SiteTreeNode[] = [
  z('quarry-ewekoro', 'QUARRY EWEKORO', /^QUARRY\s*EWEKORO$/i, [
    s('bulldozer-others', 'Bulldozer&others', /Bulldozer/i),
    s('excavators-ewekoro', 'Excavators Ewekoro', /Excavators\s*Ewekoro/i),
    s('tonly-ewekoro', 'Tonly Ewekoro', /Tonly\s*Ewekoro/i),
  ]),
  z('quarry-mfamosing', 'QUARRY MFAMOSING', /^QUARRY\s*MFAMOSING$/i, [
    s('excavators-mfamosing', 'Excavators Mfamosing', /Excavators\s*Mfamosing/i),
    s('tonly-mfamosing', 'Tonly Mfamosing', /Tonly\s*Mfamosing/i),
  ]),
];

const inboundChildren: SiteTreeNode[] = [
  z('east-inbound', 'EAST INBOUND', /^EAST\s*INBOUND$/i, [
    s('rvl-inbound', 'RVL INBOUND', /RVL\s*INBOUND/i),
  ]),
  z('north-inbound', 'NORTH INBOUND', /^NORTH\s*INBOUND$/i, [
    s('68-construction', '68 CONSTRUCTION', /^68\s*CONSTRUCTION$/i),
    s('abi-nig', 'A.B.I Nig. Ltd', /A\.?\s*B\.?\s*I\s*Nig/i),
    s('ab-kurawa', 'AB kurawa', /AB\s*kurawa/i),
    s('abs-rajah', 'ABS rajah', /ABS\s*rajah/i),
    s('ashaka-coal-inbound', 'ASHAKA COAL TRUCKS', /^ASHAKA\s*COAL\s*TRUCKS$/i),
    s('gamuya', 'Gamuya', /^Gamuya$/i),
    s('haske', 'Haske', /^Haske$/i),
    s('kushimaga-coal', 'KUSHIMAGA Coal Trucks', /KUSHIMAGA\s*Coal/i),
    s('maiyaki', 'Maiyaki', /^Maiyaki$/i),
    s('sharoji', 'Sharoji Global', /Sharoji/i),
  ]),
  z('west-inbound', 'WEST INBOUND', /^WEST\s*INBOUND$/i, [
    s('coastwise-ibt', 'COASTWISE IBT', /COASTWISE/i),
    s('skb', 'SKB', /^SKB$/i),
  ]),
];

const lightVehiclesChildren: SiteTreeNode[] = [
  z('ashaka-fleet', 'Ashaka Fleet', /^Ashaka\s*Fleet$/i, [
    s('ashaka-clinic', 'Ashaka Clinic Veh', /Ashaka\s*Clinic/i),
    s('ashaka-fire', 'Ashaka Fire Engine', /Ashaka\s*Fire/i),
    s('ashaka-ops-fleet', 'Ashaka Operational Fleet', /Ashaka\s*Operational\s*Fleet/i),
    s('ashaka-pool', 'Ashaka Pool Veh.', /Ashaka\s*Pool/i),
    s('ashaka-security', 'Ashaka Security', /^Ashaka\s*Security$/i),
  ]),
  z('ewekoro-fleet', 'Ewekoro Fleet', /^Ewekoro\s*Fleet$/i, [
    s('ewekoro-geocycle', 'Ewekoro Geocycle Truck', /Ewekoro\s*Geocycle/i),
    s('ewekoro-ops', 'Ewekoro Operational Fleet', /Ewekoro\s*Operational\s*Fleet/i),
    s('ewekoro-peoples', 'Ewekoro Peoples Transport', /Ewekoro\s*Peoples/i),
    s('ewekoro-pool', 'Ewekoro Pool Veh', /Ewekoro\s*Pool/i),
  ]),
  z('hq-fleet', 'HQ Fleet', /^HQ\s*Fleet$/i, [
    s('hq-ops', 'HQ Operational Fleet', /HQ\s*Operational\s*Fleet/i),
    s('hq-pool', 'HQ Pool', /^HQ\s*Pool$/i),
    s('hq-security', 'HQ Security', /^HQ\s*Security$/i),
  ]),
  z('mfamosing-fleet', 'Mfamosing Fleet', /^Mfamosing\s*Fleet$/i, [
    s('mfamosing-ops', 'Mfamosing Operational Fleet', /Mfamosing\s*Operational\s*Fleet/i),
    s('mfamosing-peoples', 'Mfamosing Peoples Transport', /Mfamosing\s*Peoples/i),
    s('mfamosing-pool', 'Mfamosing Pool', /^Mfamosing\s*Pool$/i),
    s('road-project', 'Road Project Department', /Road\s*Project/i),
  ]),
  z('nkb-plant', 'NKB Plant', /^NKB\s*Plant$/i, [
    s('nkb-ops', 'NKB Plant Operational Fleet', /NKB\s*Plant\s*Operational/i),
    s('nkb-pool', 'NKB Plant Pool', /NKB\s*Plant\s*Pool/i),
    s('nkb-security', 'NKB Plant Security', /NKB\s*Plant\s*Security/i),
  ]),
];

const nonOpsChildren: SiteTreeNode[] = [
  s('aa-global-non', 'A A Global(Non LH OPS)', /A\s*A\s*Global\(Non/i),
  s('aa-rajah-non', 'A.A RAJAH', /^A\.?\s*A\s*RAJAH$/i),
  s('abc-non', 'ABC(Non LH OPS)', /ABC\(Non/i),
  s('abdlas-non', 'ABDLAS(Non LH OPS)', /ABDLAS\(Non/i),
  s('abunajibullah', 'ABUNAJIBULLAH', /ABUNAJIBULLAH/i),
  s('afripower-non', 'AFRIPOWER(Non LH OPS)', /AFRIPOWER\(Non/i),
  s('ashaka-non-ops', 'Ashaka Non operational trucks(Non LH OPS)', /Ashaka\s*Non\s*operational/i),
  s('bhn-ewe-non', 'BHN EWE Non LH Ops', /BHN\s*EWE\s*Non/i),
  s('bhn-non', 'BHN Non LH ops', /BHN\s*Non\s*LH/i),
  s('big-non', 'BIG Non LH Ops', /BIG\s*Non\s*LH/i),
  s('bodoriyal', 'BODORIYAL', /BODORIYAL/i),
  s('cbv-non', 'CBV Non LH Ops', /CBV\s*Non/i),
  s('defrost-non', 'Defrost(Non LH OPS)', /Defrost\(Non/i),
  s('deomat-non', 'Deomat(Non LH OPS)', /Deomat\(Non/i),
  s('dryva-non', 'DRYVA Non LH Op', /DRYVA\s*Non/i),
  s('ebony-non', 'Ebony Non LH Op', /Ebony\s*Non\s*LH/i),
  s('ecologique-non-site', 'Ecologique', /^Ecologique$/i),
  s('ecologique-non-lh', 'ECOLOGIQUE Non LH Op', /ECOLOGIQUE\s*Non\s*LH/i),
  s('ewecoop-non', 'Ewecoop(Non LH OPS)', /Ewecoop\(Non/i),
  s('fundamental-non', 'Fundamental Choice Non Ops', /Fundamental\s*Choice\s*Non/i),
  s('gpc-non', 'GPC(Non LH OPS)', /GPC\(Non/i),
  s('gpg-non', 'GPG Non LH Op', /GPG\s*Non/i),
  s('hst-non', 'HST Non Ops', /HST\s*Non\s*Ops/i),
  s('iquasu-non', 'Iquasu Non LH Ops', /Iquasu\s*Non/i),
  s('jbc-non', 'JBC(Non LH OPS)', /JBC\(Non/i),
  s('joza-non', 'Joza Non operational', /Joza\s*Non\s*operational/i),
  s('kaysky-non', 'Kaysky Non LH Ops', /Kaysky\s*Non/i),
  s('lanre-shittu-non', 'Lanre Shittu Non LH Ops', /Lanre\s*Shittu/i),
  s('mack-chagal-non', 'Mack chagal Non LH ops', /Mack\s*chagal\s*Non/i),
  s('mondchris-non', 'MONDCHRIS LIMITED NON LH OPS', /MONDCHRIS/i),
  s('obioma-non', 'Obioma Non LH Ops', /Obioma\s*Non/i),
  s('rdymix-non', 'RDYMIX NON LH OPERATION', /RDYMIX\s*NON/i),
  s('rembam-non', 'Rembam(Non LH OPS)', /Rembam\(Non/i),
  s('rvl-non', 'RVL(Non LH OPS)', /RVL\(Non/i),
  s('sagamu-non', 'SAGAMU GLOBAL(Non LH OPS)', /SAGAMU\s*GLOBAL\(Non/i),
  s('shiwatech-non', 'Shiwatech(Non LH OPS)', /Shiwatech\(Non/i),
  s('tetralog-non', 'Tetralog(Non LH OPS)', /Tetralog\(Non/i),
  s('trucklog-non', 'TRUCKLOG Non LH Ops', /TRUCKLOG\s*Non/i),
  s('truluck-non', 'Truluck(Non LH OPS)', /Truluck\(Non/i),
  s('tsl-non', 'TSL Non LH Ops', /TSL\s*Non/i),
  s('vicky-world-non', 'Vicky World Non Ops', /Vicky\s*World\s*Non/i),
  s('whitesoul-non', 'Whitesoul Non Ops', /Whitesoul\s*Non\s*Ops|Whitesoul\s*Non\s*LH/i),
  s('wuro-yolde', 'WURO YOLDE', /WURO\s*YOLDE/i),
];

/** Excluded from live fleet / CEMENT_SITE_TREE — same policy as XN - Decommissioned. Kept to restore easily. */
export const NON_OPERATIONAL_SITE_NODE: SiteTreeNode = z(
  'non-operational',
  'Non Operational in HBM Operations',
  /Non\s*Operational\s*in\s*HBM/i,
  nonOpsChildren,
);

const readyMixChildren: SiteTreeNode[] = [
  s('bevlex-abuja', 'BEVLEX ABUJA PLANT', /BEVLEX\s*ABUJA/i),
  s('bevlex-pump', 'BEVLEX READYMIX PUMP', /BEVLEX\s*READYMIX\s*PUMP/i),
  s('bevlex-lagos', 'BEVLEX/Lagos Plant', /BEVLEX\/Lagos/i),
  s('bevlex-ph', 'BEVLEX/PH PLANT', /BEVLEX\/PH/i),
  s('boston-pump', 'BOSTON LTD PUMP READYMIX', /BOSTON\s*LTD\s*PUMP/i),
  s('habeeb-calabar', 'Habeeb Calabar', /Habeeb\s*Calabar/i),
  s('habeeb-lagos', 'HABEEB GLOBAL/LAGOS PLANT', /HABEEB\s*GLOBAL\/LAGOS/i),
  s('joza-rmx', 'JOZA RMX', /JOZA\s*RMX/i),
  s('kaysky-abuja-rmx', 'KAYSKY/ABUJA PLANT', /KAYSKY\/ABUJA/i),
  s('kaysky-lagos-rmx', 'KAYSKY/LAGOS PLANT', /KAYSKY\/LAGOS/i),
  s('rmx-light-vehicles', 'Light Vehicles', /^Light\s*Vehicles$/i),
  s('rdymix-abuja', 'RDYMIX ABUJA', /^RDYMIX\s*ABUJA$/i),
  s('rdymix-ph', 'RDYMIX PH', /^RDYMIX\s*PH$/i),
  s('truluck-ashaka', 'Truluck Ashaka', /Truluck\s*Ashaka/i),
  s('truluck-calabar', 'Truluck Calabar', /Truluck\s*Calabar/i),
  s('truluck-ph-plant', 'TRULUCK PH PLANT', /TRULUCK\s*PH\s*PLANT/i),
  s('truluck-rmx-pump', 'TRULUCK READYMIX PUMP', /TRULUCK\s*READYMIX\s*PUMP/i),
  s('truluck-abuja-plant', 'TRULUCK/ABUJA PLANT', /TRULUCK\/ABUJA/i),
  s('truluck-lagos-plant', 'TRULUCK/LAGOS PLANT', /TRULUCK\/LAGOS/i),
];

const salesChildren: SiteTreeNode[] = [
  s('angel-onyebuchi', 'ANGEL ONYEBUCHI OGU BIZ VENTURES', /ANGEL\s*ONYEBUCHI/i),
  s('iya-miliki', 'IYA MILIKI & SONS', /IYA\s*MILIKI/i),
  s('keo-merch-sales', 'K.E.O MERCHANDISING COMPANY', /K\.?\s*E\.?\s*O\s*MERCHANDISING/i),
  s('maseliz-ent', 'MASELIZ ENTERPRISES', /MASELIZ\s*ENTERPRISES/i),
  s('roglade', 'ROGLADE NIG. LTD.', /ROGLADE/i),
  s('vicross-ent-sales', 'VICROSS ENT.', /^VICROSS\s*ENT\.?$/i),
];

const hbmOrgChildren: SiteTreeNode[] = [
  z('cement', 'Cement', /^Cement$/i, cementChildren),
  z('hbm-customer-assets', 'HBM Customer Assets', /^HBM\s*Customer\s*Assets$/i, customerAssetsChildren),
  z('afr', 'Alternative Fuel & Raw-Materials', /Alternative\s*Fuel/i, [
    s('rembam-afr', 'REMBAM AFR', /^REMBAM\s*AFR$/i),
    s('truluck-afr', 'Truluck AFR', /^Truluck\s*AFR$/i),
  ]),
  z('arepo-install', 'Arepo Installation in Progress', /Arepo\s*Installation/i),
  z('ashaka-loader-driver', 'Ashaka Loader driver', /Ashaka\s*Loader\s*driver/i, [
    s('ashaka-loaders', 'Ashaka Loaders', /^Ashaka\s*Loaders$/i),
  ]),
  z('default-site', 'Default site', /^Default\s*Site$/i),
  z('hbm-quarry', 'HBM Quarry', /^HBM\s*Quarry$/i, quarryChildren),
  z('inbound-trucks', 'INBOUND TRUCKS', /^INBOUND\s*TRUCKS$/i, inboundChildren),
  z('installation-in-progress', 'Installation in progress', /^Installation\s*in\s*Progress$/i),
  z('kobo-logistics', 'Kobo Logistics', /^Kobo\s*Logistics$/i, [
    s('afripowers-2', 'AFRIPOWERS NIGERIA LIMITED 2', /AFRIPOWERS\s*NIGERIA\s*LIMITED\s*2/i),
    s('whitesoul-b', 'WhitesoulB', /^WhitesoulB$/i),
  ]),
  z('lafarge-light-vehicles', 'Lafarge Light Vehicles', /Lafarge\s*Light\s*Vehicles/i, lightVehiclesChildren),
  z('maintenance-tags', 'Maintenance Tags & Spare Tags', /Maintenance\s*Tag/i),
  z('mdd-drivers', 'MDD Drivers', /^MDD\s*Drivers$/i),
  z('new-ipi-install', 'NEW IPI INSTALL', /^NEW\s*IPI\s*INSTALL$/i, [
    s('asset-for-use', 'Asset for use', /Asset\s*for\s*use/i),
  ]),
  // Non Operational in HBM Operations is excluded from the live fleet (same as XN - Decommissioned).
  z('ready-mix', 'READY MIX', /^READY\s*MIX$/i, readyMixChildren),
  z('readymix-spothire', 'ReadyMix SpotHire', /^ReadyMix\s*SpotHire$/i, [
    s('readymix-spothire-leaf', 'READYMIX SPOTHIRE', /^READYMIX\s*SPOTHIRE$/i),
  ]),
  z('sales', 'Sales', /^Sales$/i, salesChildren),
];

function fieldOptions(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): SiteOption[] {
  return node.field === 'site' ? siteOptions : zoneOptions;
}

/** Sort every children array A–Z by label (case-insensitive). */
function sortTree(node: SiteTreeNode): SiteTreeNode {
  if (!node.children?.length) return node;
  const children = node.children
    .map(sortTree)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return { ...node, children };
}

/** Full HBM org tree shown in the Sites dropdown (collapsible). */
export const CEMENT_SITE_TREE: SiteTreeNode = sortTree({
  key: 'hbm-nigeria',
  label: 'HBM Nigeria Plc',
  match: /Africa\s*-\s*Best\s*Practices\s*-\s*HBM\s*Nigeria\s*Plc|^HBM\s*Nigeria\s*Plc$/i,
  field: 'zone',
  children: hbmOrgChildren,
});

/** Real option keys that match this node directly (not descendants). */
export function directMatchKeys(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): string[] {
  if (!node.match) return [];
  return fieldOptions(node, zoneOptions, siteOptions).filter(o => node.match!.test(o.key)).map(o => o.key);
}

/** Real option keys matched by this node OR any of its descendants (deduped, across both fields). */
export function allMatchKeys(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): string[] {
  const set = new Set<string>(directMatchKeys(node, zoneOptions, siteOptions));
  for (const child of node.children || []) {
    for (const k of allMatchKeys(child, zoneOptions, siteOptions)) set.add(k);
  }
  return Array.from(set);
}

function setsMatch(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

function exactSelectedNode(
  selectedKeys: string[],
  node: SiteTreeNode,
  zoneOptions: SiteOption[],
  siteOptions: SiteOption[],
): SiteTreeNode | null {
  for (const child of node.children || []) {
    const match = exactSelectedNode(selectedKeys, child, zoneOptions, siteOptions);
    if (match) return match;
  }

  const keys = allMatchKeys(node, zoneOptions, siteOptions);
  if (keys.length === 0) return null;
  return setsMatch(new Set(selectedKeys), new Set(keys)) ? node : null;
}

/**
 * User-facing name for the active site scope. Exact tree selections keep their
 * group name; arbitrary multi-selects collapse to a simple "Multiple sites".
 */
export function selectedSiteScopeLabel(
  selectedKeys: string[],
  zoneOptions: SiteOption[],
  siteOptions: SiteOption[],
  fallbackLabel: string | null = null,
): string | null {
  if (selectedKeys.length === 0) return fallbackLabel;

  if (selectedKeys.length === 1) {
    const key = selectedKeys[0];
    return zoneOptions.find(o => o.key === key)?.label
      ?? siteOptions.find(o => o.key === key)?.label
      ?? key;
  }

  const node = exactSelectedNode(selectedKeys, CEMENT_SITE_TREE, zoneOptions, siteOptions);
  if (node?.key === 'cement') return 'Cement site';
  if (node) return node.label;

  return 'Multiple sites';
}

function collectFieldKeys(
  node: SiteTreeNode,
  zoneOptions: SiteOption[],
  siteOptions: SiteOption[],
): { zoneKeys: Set<string>; siteKeys: Set<string> } {
  const zoneKeys = new Set<string>();
  const siteKeys = new Set<string>();
  const walk = (n: SiteTreeNode) => {
    if (n.match) {
      const keys = directMatchKeys(n, zoneOptions, siteOptions);
      if (n.field === 'site') keys.forEach(k => siteKeys.add(k));
      else keys.forEach(k => zoneKeys.add(k));
    }
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return { zoneKeys, siteKeys };
}

/**
 * Vehicle count for a node. Prefer unique zone totals (each vehicle has one zone)
 * so parent rows never exceed the org total by also summing site leaves.
 * Site-only branches (no zone match in the subtree) use site counts.
 */
export function nodeCount(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): number {
  const { zoneKeys, siteKeys } = collectFieldKeys(node, zoneOptions, siteOptions);
  if (zoneKeys.size > 0) {
    return zoneOptions.filter(o => zoneKeys.has(o.key)).reduce((s, o) => s + o.count, 0);
  }
  return siteOptions.filter(o => siteKeys.has(o.key)).reduce((s, o) => s + o.count, 0);
}

/** True if the node label or any descendant label matches the search query. */
export function nodeMatchesQuery(node: SiteTreeNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.label.toLowerCase().includes(q)) return true;
  return (node.children || []).some(c => nodeMatchesQuery(c, q));
}
