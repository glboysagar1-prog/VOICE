// intent_classifier.js — Local intent classifier for Hindi/Hinglish clinic speech

const INTENT_RULES = [
  {
    intent: 'book_appointment',
    keywords: ['appointment', 'अपॉइंटमेंट', 'अपन्मेंट', 'बुक', 'book', 'booking',
               'मिलना', 'दिखाना', 'चेकअप', 'checkup', 'टाइम', 'time', 'slot',
               'कब', 'कल', 'परसों', 'आज', 'tomorrow', 'today'],
    weight: 1.0
  },
  {
    intent: 'cancel_appointment',
    keywords: ['cancel', 'कैंसल', 'रद्द', 'हटाओ', 'हटा', 'नहीं आ', 'नहीं आना',
               'मत करो', 'छोड़', 'drop'],
    weight: 1.0
  },
  {
    intent: 'reschedule',
    keywords: ['reschedule', 'रीशेड्यूल', 'shift', 'शिफ्ट', 'बदल', 'change',
               'आगे', 'पीछे', 'postpone', 'prepone', 'move'],
    weight: 1.0
  },
  {
    intent: 'price_inquiry',
    keywords: ['price', 'प्राइस', 'cost', 'कॉस्ट', 'कितना', 'कितने', 'पैसा',
               'पैसे', 'fees', 'फीस', 'charge', 'चार्ज', 'rate', 'रेट',
               'खर्चा', 'खर्च', 'महंगा', 'सस्ता', 'budget'],
    weight: 1.0
  },
  {
    intent: 'availability',
    keywords: ['available', 'अवेलेबल', 'खाली', 'free', 'फ्री', 'open',
               'ओपन', 'कब मिलेंगे', 'मिलेगा', 'होगा', 'slot', 'स्लॉट'],
    weight: 0.8
  },
  {
    intent: 'doctor_info',
    keywords: ['doctor', 'डॉक्टर', 'डाक्टर', 'specialist', 'स्पेशलिस्ट',
               'कौन', 'who', 'experience', 'qualification', 'degree'],
    weight: 0.9
  },
  {
    intent: 'treatment_info',
    keywords: ['treatment', 'ट्रीटमेंट', 'इलाज', 'procedure', 'प्रोसीजर',
               'rct', 'filling', 'फिलिंग', 'cleaning', 'क्लीनिंग', 'extraction',
               'implant', 'इम्प्लांट', 'braces', 'ब्रेसेस', 'root canal',
               'whitening', 'crown', 'क्राउन'],
    weight: 1.0
  },
  {
    intent: 'greeting',
    keywords: ['hello', 'हेलो', 'नमस्ते', 'hi', 'हाय', 'नमस्कार',
               'good morning', 'good evening', 'शुभ'],
    weight: 0.6
  },
  {
    intent: 'general_inquiry',
    keywords: ['बारे', 'about', 'जानना', 'जानकारी', 'information', 'detail',
               'डिटेल', 'बताओ', 'बताइए', 'समझाओ', 'explain', 'क्या होता'],
    weight: 0.7
  }
];

/**
 * Classify intent from raw Hindi/Hinglish text.
 * Returns { intent: string, confidence: number, matchedKeywords: string[] }
 */
function classifyIntent(text) {
  if (!text || text.trim().length < 2) {
    return { intent: 'unknown', confidence: 0, matchedKeywords: [] };
  }

  const normalizedText = text.toLowerCase().trim();
  let bestIntent = 'unknown';
  let bestScore = 0;
  let bestMatches = [];

  for (const rule of INTENT_RULES) {
    const matched = [];
    for (const keyword of rule.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        matched.push(keyword);
      }
    }

    if (matched.length > 0) {
      // Score = (matched keywords / total keywords) * weight
      // Bonus for multiple keyword matches
      const rawScore = (matched.length / rule.keywords.length) * rule.weight;
      const multiMatchBonus = Math.min(matched.length * 0.15, 0.3);
      const score = Math.min(rawScore + multiMatchBonus, 1.0);

      if (score > bestScore) {
        bestScore = score;
        bestIntent = rule.intent;
        bestMatches = matched;
      }
    }
  }

  return {
    intent: bestIntent,
    confidence: parseFloat(bestScore.toFixed(3)),
    matchedKeywords: bestMatches
  };
}

module.exports = { classifyIntent, INTENT_RULES };
