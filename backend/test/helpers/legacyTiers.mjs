// Import AFTER env.mjs in a test that deliberately checks the OLD Free / Pro / Team behaviour: it turns the all-free switch off
// (VIBEBUILD_ALL_FREE=0), which is exactly how production restores the tiers. Without this import the default is ON.
process.env.VIBEBUILD_ALL_FREE = '0';
