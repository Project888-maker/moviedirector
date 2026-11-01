// Languages for the Translate & subtitle tools, with the code each AI model expects.
// Every code was checked against that model's published list; a missing key means the model
// doesn't offer that language, so the language is left out of that tool's menu.

export type Language = {
  label: string;
  /** ElevenLabs Dubbing (ISO 639-1). */
  eleven?: string;
  /** HeyGen Video Translate (language name). */
  heygen?: string;
  /** VEED Subtitles: language to translate the subtitles into. */
  subtitle?: string;
  /** VEED Subtitles: spoken language of the video. */
  spoken?: string;
};

export const LANGUAGES: Language[] = [
  { label: "English", eleven: "en", heygen: "English", subtitle: "en-US", spoken: "en-US" },
  { label: "Russian", eleven: "ru", heygen: "Russian", subtitle: "ru-RU", spoken: "ru-RU" },
  { label: "Chinese (Mandarin)", eleven: "zh", heygen: "Chinese", subtitle: "zh", spoken: "zh" },
  { label: "Chinese (Cantonese)", heygen: "Chinese (Cantonese, Traditional)", subtitle: "zh-HK", spoken: "zh-HK" },
  { label: "Spanish", eleven: "es", heygen: "Spanish", subtitle: "es-ES", spoken: "es-ES" },
  { label: "French", eleven: "fr", heygen: "French", subtitle: "fr-FR", spoken: "fr-FR" },
  { label: "German", eleven: "de", heygen: "German", subtitle: "de-DE", spoken: "de-DE" },
  { label: "Italian", eleven: "it", heygen: "Italian", subtitle: "it-IT", spoken: "it-IT" },
  { label: "Portuguese (Brazil)", eleven: "pt", heygen: "Portuguese (Brazil)", subtitle: "pt-BR", spoken: "pt-BR" },
  { label: "Japanese", eleven: "ja", heygen: "Japanese", subtitle: "ja-JP", spoken: "ja-JP" },
  { label: "Korean", eleven: "ko", heygen: "Korean", subtitle: "ko-KR", spoken: "ko-KR" },
  { label: "Arabic", eleven: "ar", heygen: "Arabic", subtitle: "ar-SA", spoken: "ar-SA" },
  { label: "Hindi", eleven: "hi", heygen: "Hindi" },
  { label: "Turkish", eleven: "tr", heygen: "Turkish", subtitle: "tr-TR", spoken: "tr-TR" },
  { label: "Ukrainian", eleven: "uk", heygen: "Ukrainian", subtitle: "uk-UA", spoken: "uk-UA" },
  { label: "Polish", eleven: "pl", heygen: "Polish", subtitle: "pl-PL", spoken: "pl-PL" },
  { label: "Dutch", eleven: "nl", heygen: "Dutch", subtitle: "nl-NL", spoken: "nl-NL" },
  { label: "Indonesian", eleven: "id", heygen: "Indonesian", subtitle: "id-ID", spoken: "id-ID" },
  { label: "Vietnamese", heygen: "Vietnamese (Vietnam)", subtitle: "vi-VN", spoken: "vi-VN" },
  { label: "Thai", heygen: "Thai (Thailand)", subtitle: "th-TH", spoken: "th-TH" },
  { label: "Swedish", eleven: "sv", heygen: "Swedish", subtitle: "sv-SE", spoken: "sv-SE" },
  { label: "Greek", eleven: "el", heygen: "Greek", subtitle: "el-GR", spoken: "el-GR" },
  { label: "Czech", eleven: "cs", heygen: "Czech", subtitle: "cs-CZ", spoken: "cs-CZ" },
  { label: "Romanian", eleven: "ro", heygen: "Romanian", subtitle: "ro-RO", spoken: "ro-RO" },
  { label: "Hebrew", heygen: "Hebrew (Israel)", subtitle: "he-IL", spoken: "he-IL" },
  { label: "Persian", heygen: "Persian (Iran)", subtitle: "fa-IR", spoken: "fa-IR" },
  { label: "Azerbaijani", heygen: "Azerbaijani (Latin, Azerbaijan)", subtitle: "az-AZ", spoken: "az-AZ" },
  { label: "Kazakh", heygen: "Kazakh (Kazakhstan)", subtitle: "kk-KZ", spoken: "kk-KZ" },
  { label: "Uzbek", heygen: "Uzbek (Latin, Uzbekistan)", subtitle: "uz-UZ", spoken: "uz-UZ" },
  { label: "Georgian", heygen: "Georgian (Georgia)", subtitle: "ka-GE", spoken: "ka-GE" },
  { label: "Armenian", heygen: "Armenian (Armenia)", subtitle: "hy-AM", spoken: "hy-AM" },
  { label: "Malay", eleven: "ms", heygen: "Malay", subtitle: "ms-MY", spoken: "ms-MY" },
  { label: "Filipino", eleven: "fil", heygen: "Filipino", subtitle: "fil-PH", spoken: "fil-PH" },
  { label: "Bengali", heygen: "Bengali (India)" },
  { label: "Urdu", heygen: "Urdu (Pakistan)", subtitle: "ur-PK", spoken: "ur-PK" },
  { label: "Hungarian", heygen: "Hungarian (Hungary)", subtitle: "hu-HU", spoken: "hu-HU" },
  { label: "Finnish", eleven: "fi", heygen: "Finnish", subtitle: "fi-FI", spoken: "fi-FI" },
  { label: "Danish", eleven: "da", heygen: "Danish", subtitle: "da-DK", spoken: "da-DK" },
  { label: "Norwegian", heygen: "Norwegian Bokm\u00e5l (Norway)", subtitle: "nb-NO", spoken: "nb-NO" },
  { label: "Bulgarian", eleven: "bg", heygen: "Bulgarian", subtitle: "bg-BG", spoken: "bg-BG" },
  { label: "Serbian", heygen: "Serbian (Latin, Serbia)", subtitle: "sr-RS", spoken: "sr-RS" },
  { label: "Croatian", eleven: "hr", heygen: "Croatian", subtitle: "hr-HR", spoken: "hr-HR" },
  { label: "Slovak", eleven: "sk", heygen: "Slovak", subtitle: "sk-SK", spoken: "sk-SK" },
  { label: "Tamil", eleven: "ta", heygen: "Tamil" },
  { label: "Swahili", heygen: "Swahili (Kenya)", subtitle: "sw-KE", spoken: "sw-KE" },
];
