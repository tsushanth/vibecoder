// Minecraft Addon Generator - Fully Functional
let currentAddon = null;

// Load history on page load
window.addEventListener('DOMContentLoaded', () => {
    loadHistory();
});

function useExample(element) {
    document.getElementById('addonDescription').value = element.textContent;
}

function clearInput() {
    document.getElementById('addonDescription').value = '';
    document.getElementById('addonDescription').focus();
}

function createNew() {
    document.getElementById('addonDescription').value = '';
    document.getElementById('outputSection').classList.remove('active');
    document.getElementById('addonDescription').focus();
}

function generateAddon() {
    const description = document.getElementById('addonDescription').value.trim();

    if (!description) {
        alert('Please describe what addon you want to create!');
        return;
    }

    // Parse the description and generate addon
    currentAddon = parseAndGenerate(description);

    if (!currentAddon) {
        alert('Could not understand the addon description. Try being more specific!');
        return;
    }

    // Display the addon
    displayAddon(currentAddon);

    // Save to history
    saveToHistory(currentAddon);

    // Show output section
    document.getElementById('outputSection').classList.add('active');

    // Show success message
    showSuccess('Addon generated successfully!');
}

function parseAndGenerate(description) {
    const lower = description.toLowerCase();

    // Detect addon type
    if (lower.includes('sword') || lower.includes('axe') || lower.includes('pickaxe') ||
        lower.includes('shovel') || lower.includes('hoe') || lower.includes('hammer')) {
        return generateTool(description, lower);
    } else if (lower.includes('food') || lower.includes('apple') || lower.includes('eat') ||
               lower.includes('bread') || lower.includes('meat') || lower.includes('carrot')) {
        return generateFood(description, lower);
    } else if (lower.includes('block') || lower.includes('ore') || lower.includes('stone') ||
               lower.includes('wood') || lower.includes('brick')) {
        return generateBlock(description, lower);
    } else if (lower.includes('mob') || lower.includes('zombie') || lower.includes('skeleton') ||
               lower.includes('creeper') || lower.includes('entity') || lower.includes('creature')) {
        return generateMob(description, lower);
    } else if (lower.includes('armor') || lower.includes('helmet') || lower.includes('chestplate') ||
               lower.includes('leggings') || lower.includes('boots')) {
        return generateArmor(description, lower);
    } else {
        // Default to custom item
        return generateCustomItem(description, lower);
    }
}

function generateTool(description, lower) {
    // Extract tool type
    let toolType = 'sword';
    if (lower.includes('axe')) toolType = 'axe';
    else if (lower.includes('pickaxe')) toolType = 'pickaxe';
    else if (lower.includes('shovel')) toolType = 'shovel';
    else if (lower.includes('hoe')) toolType = 'hoe';
    else if (lower.includes('hammer')) toolType = 'hammer';

    // Extract material/name
    let material = extractMaterial(lower);
    const itemName = `${material}_${toolType}`;
    const displayName = `${capitalizeFirst(material)} ${capitalizeFirst(toolType)}`;

    // Extract damage
    let damage = extractNumber(lower, ['damage', 'attack']) || getDefaultDamage(toolType);

    // Extract durability
    let durability = extractNumber(lower, ['durability', 'uses']) || 250;

    // Extract speed
    let speed = extractNumber(lower, ['speed', 'efficiency']) || 1.0;

    const addon = {
        name: displayName,
        description: description,
        type: 'Tool',
        identifier: `custom:${itemName}`,
        files: {}
    };

    // Generate manifest
    addon.files['manifest.json'] = generateManifest(displayName, description);

    // Generate behavior item
    addon.files['BP/items/' + itemName + '.json'] = generateToolBehavior(itemName, displayName, toolType, damage, durability, speed);

    // Generate resource item
    addon.files['RP/items/' + itemName + '.json'] = generateItemResource(itemName, displayName);

    // Generate texture definition
    addon.files['RP/textures/item_texture.json'] = generateItemTextureDefinition(itemName);

    return addon;
}

function generateFood(description, lower) {
    let material = extractMaterial(lower);
    const itemName = `${material}_food`;
    const displayName = `${capitalizeFirst(material)} Food`;

    // Extract nutrition
    let nutrition = extractNumber(lower, ['nutrition', 'hunger', 'food']) || 4;

    // Extract saturation
    let saturation = extractNumber(lower, ['saturation']) || 0.6;

    // Extract effects
    let effects = extractEffects(lower);

    const addon = {
        name: displayName,
        description: description,
        type: 'Food',
        identifier: `custom:${itemName}`,
        files: {}
    };

    addon.files['manifest.json'] = generateManifest(displayName, description);
    addon.files['BP/items/' + itemName + '.json'] = generateFoodBehavior(itemName, displayName, nutrition, saturation, effects);
    addon.files['RP/items/' + itemName + '.json'] = generateItemResource(itemName, displayName);
    addon.files['RP/textures/item_texture.json'] = generateItemTextureDefinition(itemName);

    return addon;
}

function generateBlock(description, lower) {
    let material = extractMaterial(lower);
    const blockName = `${material}_block`;
    const displayName = `${capitalizeFirst(material)} Block`;

    // Extract properties
    let hardness = extractNumber(lower, ['hardness', 'strength']) || 1.5;
    let resistance = extractNumber(lower, ['resistance', 'blast']) || 6.0;
    let lightEmission = extractNumber(lower, ['light', 'glow', 'luminance']) || 0;

    const addon = {
        name: displayName,
        description: description,
        type: 'Block',
        identifier: `custom:${blockName}`,
        files: {}
    };

    addon.files['manifest.json'] = generateManifest(displayName, description);
    addon.files['BP/blocks/' + blockName + '.json'] = generateBlockBehavior(blockName, displayName, hardness, resistance, lightEmission);
    addon.files['RP/blocks/' + blockName + '.json'] = generateBlockResource(blockName, displayName);
    addon.files['RP/textures/terrain_texture.json'] = generateTerrainTextureDefinition(blockName);

    return addon;
}

function generateMob(description, lower) {
    let mobType = 'zombie';
    if (lower.includes('skeleton')) mobType = 'skeleton';
    else if (lower.includes('creeper')) mobType = 'creeper';
    else if (lower.includes('spider')) mobType = 'spider';

    let material = extractMaterial(lower);
    const mobName = material ? `${material}_${mobType}` : `custom_${mobType}`;
    const displayName = material ? `${capitalizeFirst(material)} ${capitalizeFirst(mobType)}` : `Custom ${capitalizeFirst(mobType)}`;

    let health = extractNumber(lower, ['health', 'hp']) || 20;
    let damage = extractNumber(lower, ['damage', 'attack']) || 3;
    let speed = extractNumber(lower, ['speed', 'movement']) || 0.25;

    const addon = {
        name: displayName,
        description: description,
        type: 'Entity/Mob',
        identifier: `custom:${mobName}`,
        files: {}
    };

    addon.files['manifest.json'] = generateManifest(displayName, description);
    addon.files['BP/entities/' + mobName + '.json'] = generateMobBehavior(mobName, displayName, mobType, health, damage, speed);
    addon.files['RP/entity/' + mobName + '.json'] = generateMobResource(mobName, displayName, mobType);

    return addon;
}

function generateArmor(description, lower) {
    let armorType = 'helmet';
    if (lower.includes('chestplate')) armorType = 'chestplate';
    else if (lower.includes('leggings')) armorType = 'leggings';
    else if (lower.includes('boots')) armorType = 'boots';

    let material = extractMaterial(lower);
    const itemName = `${material}_${armorType}`;
    const displayName = `${capitalizeFirst(material)} ${capitalizeFirst(armorType)}`;

    let protection = extractNumber(lower, ['protection', 'defense', 'armor']) || getDefaultProtection(armorType);
    let durability = extractNumber(lower, ['durability']) || 300;

    const addon = {
        name: displayName,
        description: description,
        type: 'Armor',
        identifier: `custom:${itemName}`,
        files: {}
    };

    addon.files['manifest.json'] = generateManifest(displayName, description);
    addon.files['BP/items/' + itemName + '.json'] = generateArmorBehavior(itemName, displayName, armorType, protection, durability);
    addon.files['RP/items/' + itemName + '.json'] = generateItemResource(itemName, displayName);
    addon.files['RP/textures/item_texture.json'] = generateItemTextureDefinition(itemName);

    return addon;
}

function generateCustomItem(description, lower) {
    let material = extractMaterial(lower);
    const itemName = `${material}_item`;
    const displayName = `${capitalizeFirst(material)} Item`;

    const addon = {
        name: displayName,
        description: description,
        type: 'Custom Item',
        identifier: `custom:${itemName}`,
        files: {}
    };

    addon.files['manifest.json'] = generateManifest(displayName, description);
    addon.files['BP/items/' + itemName + '.json'] = generateCustomItemBehavior(itemName, displayName);
    addon.files['RP/items/' + itemName + '.json'] = generateItemResource(itemName, displayName);
    addon.files['RP/textures/item_texture.json'] = generateItemTextureDefinition(itemName);

    return addon;
}

// Helper Functions
function extractMaterial(text) {
    const materials = ['ruby', 'emerald', 'sapphire', 'diamond', 'gold', 'golden', 'iron', 'stone',
                      'wood', 'wooden', 'netherite', 'obsidian', 'copper', 'bronze', 'silver',
                      'titanium', 'steel', 'crystal', 'magic', 'dark', 'light', 'fire', 'ice',
                      'plasma', 'laser', 'ender', 'nether', 'ancient', 'royal', 'legendary'];

    for (let material of materials) {
        if (text.includes(material)) {
            return material;
        }
    }
    return 'custom';
}

function extractNumber(text, keywords) {
    for (let keyword of keywords) {
        const regex = new RegExp(`${keyword}[:\\s]+([0-9.]+)`, 'i');
        const match = text.match(regex);
        if (match) {
            return parseFloat(match[1]);
        }

        // Try finding number before keyword
        const regex2 = new RegExp(`([0-9.]+)[\\s]+${keyword}`, 'i');
        const match2 = text.match(regex2);
        if (match2) {
            return parseFloat(match2[1]);
        }
    }
    return null;
}

function extractEffects(text) {
    const effects = [];
    const effectMap = {
        'regeneration': { name: 'regeneration', duration: 30, amplifier: 0 },
        'speed': { name: 'speed', duration: 30, amplifier: 0 },
        'strength': { name: 'strength', duration: 30, amplifier: 0 },
        'jump': { name: 'jump_boost', duration: 30, amplifier: 0 },
        'resistance': { name: 'resistance', duration: 30, amplifier: 0 },
        'fire_resistance': { name: 'fire_resistance', duration: 30, amplifier: 0 },
        'night_vision': { name: 'night_vision', duration: 30, amplifier: 0 },
        'invisibility': { name: 'invisibility', duration: 30, amplifier: 0 }
    };

    for (let [key, effect] of Object.entries(effectMap)) {
        if (text.includes(key)) {
            effects.push(effect);
        }
    }

    return effects;
}

function getDefaultDamage(toolType) {
    const damages = {
        sword: 7,
        axe: 9,
        pickaxe: 5,
        shovel: 4,
        hoe: 1,
        hammer: 8
    };
    return damages[toolType] || 5;
}

function getDefaultProtection(armorType) {
    const protections = {
        helmet: 2,
        chestplate: 6,
        leggings: 5,
        boots: 2
    };
    return protections[armorType] || 2;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// JSON Generators
function generateManifest(name, description) {
    return {
        format_version: 2,
        header: {
            name: name,
            description: description,
            uuid: generateUUID(),
            version: [1, 0, 0],
            min_engine_version: [1, 19, 0]
        },
        modules: [
            {
                type: "data",
                uuid: generateUUID(),
                version: [1, 0, 0]
            },
            {
                type: "resources",
                uuid: generateUUID(),
                version: [1, 0, 0]
            }
        ]
    };
}

function generateToolBehavior(itemName, displayName, toolType, damage, durability, speed) {
    return {
        format_version: "1.19.0",
        "minecraft:item": {
            description: {
                identifier: `custom:${itemName}`,
                category: "equipment"
            },
            components: {
                "minecraft:max_stack_size": 1,
                "minecraft:durability": {
                    max_durability: durability
                },
                "minecraft:damage": damage,
                "minecraft:hand_equipped": true,
                "minecraft:can_destroy_in_creative": true,
                "minecraft:mining_speed": speed,
                "minecraft:display_name": {
                    value: displayName
                }
            }
        }
    };
}

function generateFoodBehavior(itemName, displayName, nutrition, saturation, effects) {
    const food = {
        format_version: "1.19.0",
        "minecraft:item": {
            description: {
                identifier: `custom:${itemName}`,
                category: "items"
            },
            components: {
                "minecraft:max_stack_size": 64,
                "minecraft:use_duration": 32,
                "minecraft:food": {
                    nutrition: nutrition,
                    saturation_modifier: saturation,
                    can_always_eat: false
                },
                "minecraft:display_name": {
                    value: displayName
                }
            }
        }
    };

    if (effects.length > 0) {
        food["minecraft:item"].components["minecraft:food"].effects = effects.map(e => ({
            name: e.name,
            chance: 1.0,
            duration: e.duration,
            amplifier: e.amplifier
        }));
    }

    return food;
}

function generateBlockBehavior(blockName, displayName, hardness, resistance, lightEmission) {
    const block = {
        format_version: "1.19.0",
        "minecraft:block": {
            description: {
                identifier: `custom:${blockName}`
            },
            components: {
                "minecraft:destructible_by_mining": {
                    seconds_to_destroy: hardness
                },
                "minecraft:destructible_by_explosion": {
                    explosion_resistance: resistance
                },
                "minecraft:friction": 0.6,
                "minecraft:map_color": "#ffffff"
            }
        }
    };

    if (lightEmission > 0) {
        block["minecraft:block"].components["minecraft:light_emission"] = Math.min(15, lightEmission);
    }

    return block;
}

function generateMobBehavior(mobName, displayName, baseType, health, damage, speed) {
    return {
        format_version: "1.19.0",
        "minecraft:entity": {
            description: {
                identifier: `custom:${mobName}`,
                is_spawnable: true,
                is_summonable: true,
                is_experimental: false
            },
            component_groups: {},
            components: {
                "minecraft:type_family": {
                    family: ["monster", "undead"]
                },
                "minecraft:health": {
                    value: health,
                    max: health
                },
                "minecraft:attack": {
                    damage: damage
                },
                "minecraft:movement": {
                    value: speed
                },
                "minecraft:navigation.walk": {
                    can_path_over_water: false,
                    avoid_water: true
                },
                "minecraft:movement.basic": {},
                "minecraft:jump.static": {},
                "minecraft:can_climb": {},
                "minecraft:collision_box": {
                    width: 0.6,
                    height: 1.8
                },
                "minecraft:nameable": {},
                "minecraft:physics": {},
                "minecraft:pushable": {
                    is_pushable: true,
                    is_pushable_by_piston: true
                },
                "minecraft:behavior.melee_attack": {
                    priority: 3
                },
                "minecraft:behavior.random_stroll": {
                    priority: 6,
                    speed_multiplier: 1
                },
                "minecraft:behavior.look_at_player": {
                    priority: 7,
                    look_distance: 6
                },
                "minecraft:behavior.random_look_around": {
                    priority: 8
                }
            }
        }
    };
}

function generateArmorBehavior(itemName, displayName, armorType, protection, durability) {
    const slotMap = {
        helmet: 'slot.armor.head',
        chestplate: 'slot.armor.chest',
        leggings: 'slot.armor.legs',
        boots: 'slot.armor.feet'
    };

    return {
        format_version: "1.19.0",
        "minecraft:item": {
            description: {
                identifier: `custom:${itemName}`,
                category: "equipment"
            },
            components: {
                "minecraft:max_stack_size": 1,
                "minecraft:durability": {
                    max_durability: durability
                },
                "minecraft:wearable": {
                    slot: slotMap[armorType]
                },
                "minecraft:armor": {
                    protection: protection
                },
                "minecraft:display_name": {
                    value: displayName
                }
            }
        }
    };
}

function generateCustomItemBehavior(itemName, displayName) {
    return {
        format_version: "1.19.0",
        "minecraft:item": {
            description: {
                identifier: `custom:${itemName}`,
                category: "items"
            },
            components: {
                "minecraft:max_stack_size": 64,
                "minecraft:display_name": {
                    value: displayName
                }
            }
        }
    };
}

function generateItemResource(itemName, displayName) {
    return {
        format_version: "1.19.0",
        "minecraft:item": {
            description: {
                identifier: `custom:${itemName}`,
                category: "items"
            },
            components: {
                "minecraft:icon": itemName
            }
        }
    };
}

function generateBlockResource(blockName, displayName) {
    return {
        format_version: "1.19.0",
        "minecraft:block": {
            description: {
                identifier: `custom:${blockName}`
            },
            components: {
                "minecraft:material_instances": {
                    "*": {
                        texture: blockName,
                        render_method: "opaque"
                    }
                }
            }
        }
    };
}

function generateMobResource(mobName, displayName, baseType) {
    return {
        format_version: "1.19.0",
        "minecraft:client_entity": {
            description: {
                identifier: `custom:${mobName}`,
                materials: {
                    default: "entity"
                },
                textures: {
                    default: `textures/entity/${mobName}`
                },
                geometry: {
                    default: `geometry.${baseType}`
                },
                render_controllers: ["controller.render.default"]
            }
        }
    };
}

function generateItemTextureDefinition(itemName) {
    return {
        resource_pack_name: "Custom Addon",
        texture_name: "atlas.items",
        texture_data: {
            [itemName]: {
                textures: `textures/items/${itemName}`
            }
        }
    };
}

function generateTerrainTextureDefinition(blockName) {
    return {
        resource_pack_name: "Custom Addon",
        texture_name: "atlas.terrain",
        padding: 8,
        num_mip_levels: 4,
        texture_data: {
            [blockName]: {
                textures: `textures/blocks/${blockName}`
            }
        }
    };
}

// Display Functions
function displayAddon(addon) {
    // Update addon info
    document.getElementById('addonName').textContent = addon.name;
    document.getElementById('addonDescription').textContent = addon.description;
    document.getElementById('addonType').textContent = addon.type;

    // Generate file tabs
    const tabsContainer = document.getElementById('fileTabs');
    const contentsContainer = document.getElementById('fileContents');

    tabsContainer.innerHTML = '';
    contentsContainer.innerHTML = '';

    const fileNames = Object.keys(addon.files);
    fileNames.forEach((fileName, index) => {
        // Create tab
        const tab = document.createElement('button');
        tab.className = 'tab' + (index === 0 ? ' active' : '');
        tab.textContent = fileName;
        tab.onclick = () => switchTab(fileName);
        tabsContainer.appendChild(tab);

        // Create content
        const content = document.createElement('div');
        content.className = 'file-content' + (index === 0 ? ' active' : '');
        content.id = 'file-' + index;
        content.dataset.fileName = fileName;

        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(addon.files[fileName], null, 2);
        content.appendChild(pre);

        contentsContainer.appendChild(content);
    });
}

function switchTab(fileName) {
    // Update tabs
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        if (tab.textContent === fileName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Update content
    const contents = document.querySelectorAll('.file-content');
    contents.forEach(content => {
        if (content.dataset.fileName === fileName) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

function showSuccess(message) {
    const container = document.getElementById('successMessage');
    container.innerHTML = `<div class="success-message">${message}</div>`;
    setTimeout(() => {
        container.innerHTML = '';
    }, 3000);
}

// Download Function
function downloadAddon() {
    if (!currentAddon) return;

    // Create a text file with all the addon files
    let content = `MINECRAFT BEDROCK ADDON: ${currentAddon.name}\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `Description: ${currentAddon.description}\n`;
    content += `Type: ${currentAddon.type}\n`;
    content += `Generated: ${new Date().toLocaleString()}\n\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `INSTALLATION INSTRUCTIONS:\n`;
    content += `1. Create a new folder for your addon\n`;
    content += `2. Create the folder structure as shown below\n`;
    content += `3. Copy each file's content into the corresponding file\n`;
    content += `4. Import the addon into Minecraft Bedrock Edition\n\n`;
    content += `${'='.repeat(60)}\n\n`;

    for (let [fileName, fileContent] of Object.entries(currentAddon.files)) {
        content += `FILE: ${fileName}\n`;
        content += `${'-'.repeat(60)}\n`;
        content += JSON.stringify(fileContent, null, 2);
        content += `\n\n${'='.repeat(60)}\n\n`;
    }

    // Create and download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentAddon.name.replace(/\s/g, '_')}_addon.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Addon files downloaded! Check your downloads folder.');
}

// History Functions
function saveToHistory(addon) {
    let history = JSON.parse(localStorage.getItem('addonHistory') || '[]');

    const historyItem = {
        name: addon.name,
        description: addon.description,
        type: addon.type,
        timestamp: new Date().toISOString(),
        addon: addon
    };

    // Add to beginning of array
    history.unshift(historyItem);

    // Keep only last 10
    history = history.slice(0, 10);

    localStorage.setItem('addonHistory', JSON.stringify(history));

    loadHistory();
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem('addonHistory') || '[]');
    const container = document.getElementById('historyList');

    if (history.length === 0) {
        container.innerHTML = '<div class="empty-state">No addons created yet. Start by describing your first addon!</div>';
        return;
    }

    container.innerHTML = history.map((item, index) => `
        <div class="history-item" onclick="loadFromHistory(${index})">
            <strong>${item.name}</strong>
            <small>${item.type} - ${new Date(item.timestamp).toLocaleString()}</small>
        </div>
    `).join('');
}

function loadFromHistory(index) {
    const history = JSON.parse(localStorage.getItem('addonHistory') || '[]');
    const item = history[index];

    if (!item) return;

    currentAddon = item.addon;
    displayAddon(currentAddon);

    document.getElementById('addonDescription').value = item.description;
    document.getElementById('outputSection').classList.add('active');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
