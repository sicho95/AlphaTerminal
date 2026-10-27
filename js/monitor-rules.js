/** Versioned declarative rule contract used by local PWA and NAS.
 * Values are loaded from shared/monitor-rules.json, which is also shipped into the worker image.
 */
export const FALLBACK_RULES=Object.freeze({
  "contract_version": 2,
  "rule_version": "monitor-v2",
  "near_stop_percent": 3,
  "performance_percent": 12,
  "rsi_period": 14,
  "rsi_low": 25,
  "rsi_high": 75,
  "atr_period": 14,
  "atr_default_multiplier": 3,
  "quotes_min_minutes": 5,
  "quotes_max_minutes": 120,
  "news_min_minutes": 15,
  "news_max_minutes": 120,
  "source_names": [
    "Yahoo Finance",
    "OKSURF",
    "AMF",
    "BCE",
    "Café de la Bourse",
    "GDELT"
  ],
  "news_lexicon": {
    "topics": {
      "taux": [
        "bce",
        "fed",
        "banque centrale",
        "taux directeur",
        "taux directeurs",
        "interest rate",
        "fomc"
      ],
      "inflation": [
        "inflation",
        "cpi",
        "pce",
        "prix a la consommation"
      ],
      "energie": [
        "petrole",
        "brent",
        "gaz",
        "gas",
        "oil",
        "opep",
        "opec"
      ],
      "geopolitique": [
        "sanctions",
        "tarifs douaniers",
        "tariffs",
        "guerre commerciale",
        "export controls",
        "embargo"
      ],
      "tech": [
        "semi conducteur",
        "semiconductor",
        "intelligence artificielle",
        "data center",
        "gpu",
        "cloud"
      ],
      "credit": [
        "defaut",
        "default",
        "downgrade",
        "liquidite",
        "liquidity"
      ]
    },
    "high": [
      "suspension de cotation",
      "profit warning",
      "avertissement sur resultats",
      "offre publique",
      "opa",
      "faillite",
      "bankruptcy",
      "sanctions",
      "retrait de previsions",
      "guidance cut",
      "guidance lowered"
    ],
    "medium": [
      "resultats",
      "earnings",
      "previsions",
      "guidance",
      "acquisition",
      "merger",
      "taux directeur",
      "taux directeurs",
      "inflation",
      "tariffs",
      "embargo"
    ],
    "sector_map": {
      "technology": [
        "tech"
      ],
      "ia": [
        "tech"
      ],
      "tech": [
        "tech"
      ],
      "energy": [
        "energie"
      ],
      "energie": [
        "energie"
      ],
      "world": [
        "taux",
        "inflation",
        "geopolitique"
      ],
      "europe": [
        "taux",
        "inflation",
        "energie"
      ],
      "emerging": [
        "geopolitique",
        "inflation"
      ],
      "semi-conducteurs": [
        "tech"
      ],
      "finance": [
        "taux",
        "credit"
      ],
      "obligations": [
        "taux",
        "inflation"
      ]
    }
  }
});
let rules=FALLBACK_RULES;
let loading=null;
export function getMonitorRules(){return rules;}
export async function loadMonitorRules(){
  if(loading)return loading;
  loading=(async()=>{
    try{
      const response=await fetch(new URL('../shared/monitor-rules.json',import.meta.url));
      if(!response.ok)throw Error('Contrat de règles inaccessible');
      const value=await response.json();
      if(value.contract_version!==FALLBACK_RULES.contract_version||!value.rule_version)throw Error('Version de contrat incompatible');
      rules=Object.freeze(value);
    }catch(error){console.warn('Règles locales par défaut, contrat central inaccessible',error);}
    return rules;
  })();
  return loading;
}
