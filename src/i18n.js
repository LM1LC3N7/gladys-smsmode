// -----------------------------------------------------------------------------
// Texts shown to the user (status, buttons, scene errors), English and
// French. None of them ever holds the API key, a whole phone number or what
// smsmode answered word for word.
// -----------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, '0');

/** "14:05" in Paris time (the status names a time the user reads on a French clock). */
export function parisTime(t) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const { type, value } of fmt.formatToParts(new Date(t))) parts[type] = value;
  return `${two(Number(parts.hour))}:${two(Number(parts.minute))}`;
}

export const T = {
  status: {
    no_key: {
      en: 'Type the smsmode API key in the configuration.',
      fr: "Saisissez la clé d'API smsmode dans la configuration.",
    },
    bad_key: {
      en: 'The API key holds characters smsmode keys never have (spaces, accents): copy it again.',
      fr: "La clé d'API contient des caractères qu'une clé smsmode n'a jamais (espaces, accents) : copiez-la à nouveau.",
    },
    bad_sender: {
      en: 'The sender must be 3 to 11 letters or digits, with at least one letter: nothing is sent until it is fixed.',
      fr: "L'émetteur doit faire 3 à 11 lettres ou chiffres, dont au moins une lettre : rien n'est envoyé tant qu'il n'est pas corrigé.",
    },
    config_unread: (seconds) => ({
      en: `The configuration could not be read from Gladys: new try in ${seconds} s.`,
      fr: `La configuration n'a pas pu être lue depuis Gladys : nouvel essai dans ${seconds} s.`,
    }),
    refused: {
      en: 'smsmode refused the API key (401): nothing is sent with it. Type another key, or click "Check the key and the credit".',
      fr: "smsmode a refusé la clé d'API (401) : rien n'est envoyé avec elle. Saisissez une autre clé, ou cliquez sur « Vérifier la clé et le crédit ».",
    },
    paused: (time, why) => ({
      en: `smsmode ${why === 'rate_limited' ? 'asked to slow down (429)' : 'is failing (5xx)'}: nothing is sent before ${time} (Paris time).`,
      fr: `smsmode ${why === 'rate_limited' ? 'a demandé de ralentir (429)' : 'est en panne (5xx)'} : rien n'est envoyé avant ${time} (heure de Paris).`,
    }),
    credit: {
      en: 'Your smsmode credit was too low at the last send (402): top it up on smsmode.com.',
      fr: 'Votre crédit smsmode était insuffisant au dernier envoi (402) : rechargez-le sur smsmode.com.',
    },
    forbidden: {
      en: 'smsmode refused the sender or the rights of the key at the last send (403): check the sender in your smsmode account.',
      fr: "smsmode a refusé l'émetteur ou les droits de la clé au dernier envoi (403) : vérifiez l'émetteur dans votre compte smsmode.",
    },
    ready: (cap) => ({
      en: `Ready: SMS leave only from a scene action or the test button, ${cap} SMS per hour at most.`,
      fr: `Prêt : un SMS ne part que d'une action de scène ou du bouton de test, ${cap} SMS par heure au plus.`,
    }),
    bad_recipients: {
      en: ' The default numbers do not read (French mobile, or international number with + or 00, 5 at most).',
      fr: ' Les numéros par défaut sont illisibles (mobile français, ou numéro international avec + ou 00, 5 au plus).',
    },
    data_unreadable: {
      en: ' /data is unreadable: the hourly cap counts the SMS of this run only.',
      fr: ' /data est illisible : le plafond horaire ne compte que les SMS de cette session.',
    },
  },

  // Why a message did not leave, or may have left.
  reason: {
    no_key: { en: 'no API key', fr: "pas de clé d'API" },
    bad_key: { en: 'the API key does not read', fr: "la clé d'API est illisible" },
    bad_sender: { en: 'the sender does not read', fr: "l'émetteur est illisible" },
    config_unread: {
      en: 'the configuration is not read yet',
      fr: "la configuration n'est pas encore lue",
    },
    no_recipient: {
      en: 'no recipient (none in the action, none by default)',
      fr: "aucun destinataire (ni dans l'action, ni par défaut)",
    },
    bad_recipients: {
      en: 'a number does not read (French mobile, or international number with + or 00, 5 at most)',
      fr: 'un numéro est illisible (mobile français, ou numéro international avec + ou 00, 5 au plus)',
    },
    landline: {
      en: 'a French landline or special number receives no SMS',
      fr: 'un fixe ou un numéro spécial français ne reçoit pas de SMS',
    },
    empty_text: { en: 'the text is empty', fr: 'le texte est vide' },
    queue_full: {
      en: 'too many SMS waiting for their turn',
      fr: 'trop de SMS attendent leur tour',
    },
    time: { en: 'no time left for the request', fr: 'plus le temps de faire la requête' },
    stopped: { en: 'the integration stopped', fr: "l'intégration s'est arrêtée" },
    paused: { en: 'smsmode asked for a pause', fr: 'smsmode a demandé une pause' },
    cap: { en: 'the hourly cap is reached', fr: 'le plafond horaire est atteint' },
    refused: { en: 'the API key was refused (401)', fr: "la clé d'API a été refusée (401)" },
    credit: { en: 'not enough smsmode credit (402)', fr: 'crédit smsmode insuffisant (402)' },
    forbidden: {
      en: 'sender or key rights refused (403)',
      fr: 'émetteur ou droits de la clé refusés (403)',
    },
    invalid: { en: 'refused by smsmode (400)', fr: 'refusé par smsmode (400)' },
    rate_limited: {
      en: 'smsmode asked to slow down (429)',
      fr: 'smsmode a demandé de ralentir (429)',
    },
    server: { en: 'smsmode failed (5xx)', fr: 'smsmode en panne (5xx)' },
    timeout: { en: 'smsmode did not answer in time', fr: "smsmode n'a pas répondu à temps" },
    network: { en: 'network error', fr: 'erreur réseau' },
    redirect: { en: 'unexpected redirect', fr: 'redirection inattendue' },
    http: { en: 'unexpected answer', fr: 'réponse inattendue' },
    too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  },

  /** The summary of a send, for the scene log and the test button. */
  summary({ accepted, uncertain, notSent, reasons, truncated }) {
    const why = (lang) => [...reasons].map((r) => T.reason[r]?.[lang] ?? r).join(', ');
    const parts = { en: [], fr: [] };
    if (accepted) {
      parts.en.push(`${accepted} SMS accepted by smsmode`);
      parts.fr.push(`${accepted} SMS accepté(s) par smsmode`);
    }
    if (uncertain) {
      parts.en.push(
        `${uncertain} sent without confirmation (may have left: not tried again, to avoid a second paid SMS)`,
      );
      parts.fr.push(
        `${uncertain} envoyé(s) sans confirmation (a pu partir : pas de nouvel essai, pour éviter un second SMS payant)`,
      );
    }
    if (notSent) {
      parts.en.push(`${notSent} not sent`);
      parts.fr.push(`${notSent} non envoyé(s)`);
    }
    let en = parts.en.join('; ');
    let fr = parts.fr.join(' ; ');
    if (reasons.size) {
      en += ` (${why('en')})`;
      fr += ` (${why('fr')})`;
    }
    if (truncated) {
      en += '. The text was cut to the maximum number of SMS per message.';
      fr += '. Le texte a été coupé au nombre maximal de SMS par message.';
    }
    return { en: `${en}.`.replace('..', '.'), fr: `${fr}.`.replace('..', '.') };
  },

  check: {
    ok: (balance) => ({
      en: `smsmode accepted the key.${balance ? ` Balance: ${balance}.` : ''}`,
      fr: `smsmode a accepté la clé.${balance ? ` Solde : ${balance}.` : ''}`,
    }),
    no_balance: {
      en: 'smsmode accepted the key; its role does not allow reading the balance (403).',
      fr: 'smsmode a accepté la clé ; son rôle ne permet pas de lire le solde (403).',
    },
  },

  testText: 'Gladys : SMS de test du module smsmode.',
};

/** An Error for a scene log: French first (the module serves France), then English. */
export function sceneError(message) {
  return new Error(`${message.fr} | ${message.en}`);
}

/** A reason alone, as a two-language message. */
export function reasonMessage(code, prefix = { en: 'Nothing sent', fr: 'Rien envoyé' }) {
  const r = T.reason[code] ?? { en: code, fr: code };
  return { en: `${prefix.en}: ${r.en}.`, fr: `${prefix.fr} : ${r.fr}.` };
}
