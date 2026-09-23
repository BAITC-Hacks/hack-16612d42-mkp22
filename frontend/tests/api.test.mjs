import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatPayload } from '../api.js';

test('default payload respects existing backend extra=forbid for every UI language', () => {
  for (const language of ['ru', 'kz', 'en']) {
    const history = [{ role: 'user', content: 'EKT-16' }];
    const confirmCart = [{ product_id: '123', quantity: 0.5 }];
    assert.deepEqual(createChatPayload({ query: 'EKT-16', history, confirmCart, language }), {
      query: 'EKT-16', history, confirm_cart: confirmCart,
    });
  }
});

test('language is sent only when backend support is explicitly enabled', () => {
  for (const language of ['ru', 'kz', 'en']) {
    const request = createChatPayload({ query: 'EKT-16', history: [], language }, { language: true });
    assert.equal(request.language, language);
  }
  assert.equal(createChatPayload({ query: 'EKT-16', history: [], language: 'invalid' }, { language: true }).language, 'ru');
});
