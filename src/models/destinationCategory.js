export const auditoriumCaption=/^\s*(?:audi(?:torium)?|cinema|screen)\s*[-#]?\s*\d+\s*$/i;
export const transportLobbyCaption=/\b(?:lift|elevator|stair(?:case)?)\s+(?:arrival\s+)?lobb(?:y|ies)?\b/i;
const types=[
  [transportLobbyCaption,'Lobby'],
  [/\b(?:opd|outpatient)\s+reg(?:istration)?\b/i,'Reception'],
  [auditoriumCaption,'Auditorium'],
  [/^\s*FC\s*[-–]?\s*\d{1,2}\b/i,'Shop unit'],
  [/^\s*(?!(?:I?X)\s*\d{3,4}\b)[A-Z]{1,2}\s*[-–]?\s*\d{3,4}[A-Z]?\b/i,'Shop unit'],
  [/\b(?:consultation|consultant|opd|outpatient)\b/i,'Consultation'],
  [/\b(?:reception|registration|billing|admission)\b/i,'Reception'],
  [/\b(?:toilet|restroom|washroom|lavatory|wc)\b/i,'Washroom'],
  [/\b(?:food court|cafeteria|canteen)\b/i,'Food Court'],
  [/\bpharmacy\b/i,'Pharmacy'],[/\batm\b/i,'ATM'],
  [/\bnurs(?:e|es|ing)\s+station\b/i,'Nurse station'],
  [/\b(?:dialysis|endoscopy|physiotherapy|mammography|ultrasonography|audiometry|audio metry|ercp|dexa|tmt|echo|ct scan|mri)\b/i,'Clinical service'],
  [/\bparking\b/i,'Parking'],[/^FHC(?:[ .-]*\d+)?$/i,'Fire hose cabinet'],
  [/\b(?:ramp)\b/i,'Ramp'],[/\b(?:waiting area|waiting hall)\b/i,'Waiting area']
];
export function destinationCategory(text){
  return typeof text==='string'?types.find(([pattern])=>pattern.test(text))?.[1]:undefined;
}

export function isDestinationCaption(text){
  return typeof text==='string'&&!/\b(?:pit|cutout|shaft|headroom|equipment load|water tank|machine room)\b/i.test(text);
}

export function hasShopIdentifiers(labels){
  const units=labels.filter(l=>destinationCategory(l.text)==='Shop unit'&&(l.confidence??100)>=80);
  return units.some(l=>l.source==='pdf-text'||/^FC\s*[-–]?\s*\d{1,2}\b/i.test(l.text.trim()))||new Set(units.map(l=>l.text.replace(/\s+/g,'').toUpperCase())).size>=2;
}
