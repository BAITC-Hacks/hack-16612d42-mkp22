// Enable only after ChatRequest accepts language and the model uses it.
// The existing backend has extra='forbid', so the default payload stays unchanged.
export const backendCapabilities = Object.freeze({ language: false });

export function createChatPayload({ query, history, confirmCart = [], language = 'ru' }, capabilities = backendCapabilities) {
  const payload = { query, history, confirm_cart: confirmCart };
  if (capabilities.language === true) payload.language = ['ru', 'kz', 'en'].includes(language) ? language : 'ru';
  return payload;
}
