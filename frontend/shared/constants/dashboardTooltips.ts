export const ENGINE_TOOLTIPS: Record<string, string> = {
  SSH: "Compte les echec de connexion SSH. Le score monte quand les tentatives de login suspectes se multiplient.",
  WEB: "Observe le trafic HTTP anormal. Le score monte quand le comportement ressemble a du scan ou a de l'exploration automatique.",
  FTP: "Compte les transferts de fichiers inhabituels. Le score monte si le flux ressemble a une possible exfiltration.",
  SESSION: "Observe les evenements de session et de connexion. Le score monte quand la session semble reutilisee ou compromise.",
  KERNEL: "Regarde les erreurs noyau et syslog. Le score monte quand le systeme semble devenir instable.",
  PREDICTION: "Regroupe les signaux avant attaque. Il traduit une pression pre-incident plutot qu'une alarme brute.",
  CORRELATION: "Relie plusieurs signaux pour voir s'ils racontent la meme histoire.",
  CHAIN: "Suit une suite d'evenements qui ressemblent a une attaque composee.",
};

export const METRIC_TOOLTIPS = {
  confidence:
    "Score calcule comme: 35% accord modeles + 25% (1 - faux positifs) + 20% (1 - drift) + 20% stabilite, puis petite penalite si le bruit depasse 50%.",
  agreement:
    "Part d'accord entre les modeles. Plus les modeles donnent la meme lecture, plus la valeur monte.",
  drift:
    "Ecart absolu entre le taux d'anomalies de la session actuelle et celui de la session precedente. Plus la difference est grande, plus le comportement a change.",
  stability:
    "On regarde les 3 dernieres sessions: nombre d'alarmes, taux de faux positifs et taux d'anomalies. Si ces signaux bougent peu, la stabilite monte.",
  false_positive_rate:
    "Part des alarmes qui ont besoin de tres peu de modeles pour exister. Plus ce taux est bas, mieux c'est.",
  threshold_change:
    "Compare les seuils du meme moteur entre Pass 1 et Pass 2.",
};

export function getEngineTooltip(engine: string | null | undefined): string {
  const key = String(engine ?? "").trim().toUpperCase();
  return ENGINE_TOOLTIPS[key] ?? "Moteur de detection du pipeline.";
}

export function getMetricTooltip(metric: keyof typeof METRIC_TOOLTIPS): string {
  return METRIC_TOOLTIPS[metric];
}
