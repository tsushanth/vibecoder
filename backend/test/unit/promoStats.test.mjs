import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePromotion, SURFACE_PAYLOAD } from '../../lib/telegram/promoStats.js';

const promo = (event, surface, user, lang = 'en') => ({ event, user_id: user, props: { surface, lang } });
const bot = (event, chat_ref, props = {}) => ({ event, chat_ref, props });

test('promotion funnel per surface: impressions -> taps -> starts -> builds -> finished -> linked', () => {
    const p = summarizePromotion(
        [promo('promo_impression', 'banner', 'u1'), promo('promo_impression', 'banner', 'u1'), promo('promo_impression', 'banner', 'u2', 'de'), promo('promo_tap', 'banner', 'u1'), promo('promo_dismiss', 'banner', 'u2'),
         promo('promo_impression', 'create_card', 'u1'), promo('promo_tap', 'create_card', 'u1', 'de'), promo('promo_impression', 'nope', 'u1'), { event: 'promo_tap', props: {} }],
        [bot('start', 'c1', { start_payload: 'app', new_chat: true }), bot('build_queued', 'c1'), bot('build_queued', 'c1'), bot('build_finished', 'c1'), bot('link_done', 'c1'),
         bot('start', 'c2', { start_payload: 'app_card', new_chat: true }), bot('build_queued', 'c2'),
         bot('start', 'c3', { start_payload: 'web_home', new_chat: false }), bot('start', 'c3', { start_payload: 'app', new_chat: false }), bot('build_finished', 'c3'),
         bot('update_received', 'c4'), bot('build_queued', 'c4'), bot('start', 'c5', { start_payload: 'other' }), bot('start', 'c6', {})],
    );
    assert.deepEqual(p.surfaces.banner, { impressions: 3, impressionUsers: 2, taps: 1, tapUsers: 1, dismissals: 1, starts: 2, chats: 1, newChats: 1, built: 1, finished: 1, linked: 1 });
    assert.deepEqual(p.surfaces.create_card, { impressions: 1, impressionUsers: 1, taps: 1, tapUsers: 1, dismissals: 0, starts: 1, chats: 1, newChats: 1, built: 1, finished: 0, linked: 0 });
    assert.deepEqual(p.surfaces.web_home, { impressions: 0, impressionUsers: 0, taps: 0, tapUsers: 0, dismissals: 0, starts: 1, chats: 1, newChats: 0, built: 0, finished: 1, linked: 0 }, 'a chat counts for the surface of its FIRST start');
    assert.deepEqual(p.unattributed, { chats: 3, built: 1, finished: 0, linked: 0 });
    assert.deepEqual(p.byLanguage, { en: { impressions: 3, taps: 1 }, de: { impressions: 1, taps: 1 } });
    assert.equal(p.tapRate.banner, 0.333); assert.equal(p.tapRate.account_row, null);
    assert.deepEqual(Object.keys(p.surfaces), Object.keys(SURFACE_PAYLOAD));
});

test('empty input gives zeros, never throws', () => {
    const p = summarizePromotion(); assert.equal(p.surfaces.banner.impressions, 0); assert.equal(p.unattributed.chats, 0);
});
