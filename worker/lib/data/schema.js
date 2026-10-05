// worker/ runs standalone, so platform/data/schema.js lives at lib/vendor/schema.js (byte-identical, drift-tested).
// lib/jobs/validate.js (a byte-identical copy of platform/jobs/validate.js) imports it from here.
export * from '../vendor/schema.js';
