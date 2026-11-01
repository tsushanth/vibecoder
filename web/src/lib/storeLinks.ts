// Where the mobile apps live. Edit this file to change a store link.

const PLAY_BASE = 'https://play.google.com/store/apps/details?id=com.kreativekoala.vibecoder';

/** Google Play listing, tagged so installs started from the landing page can be told apart. */
export const PLAY_STORE_URL = `${PLAY_BASE}&utm_source=vibebuild_web&utm_medium=landing`;

/**
 * App Store URL for the iOS app. EMPTY ON PURPOSE: the iOS badge is hidden until this holds a verified, live
 * https://apps.apple.com/... link. Do not guess a URL here. Apple requires its own badge artwork; swap the text badge in
 * StoreBadges.tsx for Apple's official SVG when you set this.
 */
export const IOS_APP_STORE_URL = '';
