// Chinese has three languages in this product: Simplified ("zh", also what old clients send), Traditional for Taiwan ("zh-TW",
// also the Hant script and Macau) and Traditional for Hong Kong ("zh-HK"). One place decides which one a client tag means.

/**
 * `parts` are the lower-case subtags after "zh" (e.g. ['hant', 'tw']). The Hans script wins over a region (zh-Hans-HK is
 * Simplified), then HK, then Hant/TW/MO; anything else (no subtag, CN, SG, other regions) is Simplified, as it always was.
 */
export function chineseTag(parts) {
    const p = Array.isArray(parts) ? parts : [];
    if (p.includes('hans')) return 'zh';
    if (p.includes('hk')) return 'zh-HK';
    if (p.includes('hant') || p.includes('tw') || p.includes('mo')) return 'zh-TW';
    return 'zh';
}
