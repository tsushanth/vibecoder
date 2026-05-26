/* ===================================================================
   Plantopia — Plant Care Companion
   Complete application logic — fully implemented
   =================================================================== */

(function () {
    'use strict';

    // ─── Plant Library Database ───
    const PLANT_LIBRARY = [
        {
            id: 'monstera',
            name: 'Monstera Deliciosa',
            sciName: 'Monstera deliciosa',
            icon: '🪴',
            category: ['indoor'],
            water: 'Every 7-10 days',
            waterDays: 8,
            light: 'Bright indirect',
            humidity: 'Medium-High',
            temp: '65-85°F',
            difficulty: 'Easy',
            toxicity: 'Toxic to pets and humans (calcium oxalate crystals)',
            origin: 'Central America (Southern Mexico to Panama)',
            growthRate: 'Moderate to Fast',
            maxSize: '6-10 ft indoors, 60+ ft in wild',
            commonProblems: ['Yellow leaves from overwatering', 'Brown leaf edges from low humidity', 'Leggy growth from insufficient light', 'Root rot in poorly draining soil'],
            description: 'The Swiss Cheese Plant is beloved for its large, glossy, heart-shaped leaves that develop distinctive holes and splits as they mature. Native to Central American rainforests, it climbs trees using aerial roots. In the wild it can reach over 60 feet tall.',
            flower: 'Monstera rarely flowers indoors. In the wild, it produces a creamy-white spathe (similar to a peace lily) surrounding a cylindrical spadix. The fruit that develops takes over a year to ripen and tastes like a combination of banana and pineapple — hence the name "deliciosa."',
            careTips: [
                'Wipe leaves regularly to remove dust and help photosynthesis',
                'Provide a moss pole or trellis for climbing support',
                'Allow top 2 inches of soil to dry between waterings',
                'Yellow leaves often indicate overwatering',
                'Rotate the plant quarterly for even growth'
            ]
        },
        {
            id: 'pothos',
            name: 'Golden Pothos',
            sciName: 'Epipremnum aureum',
            icon: '🌿',
            category: ['indoor'],
            water: 'Every 7-14 days',
            waterDays: 10,
            light: 'Low to bright indirect',
            humidity: 'Low-Medium',
            temp: '60-85°F',
            difficulty: 'Very Easy',
            toxicity: 'Toxic to pets and humans (calcium oxalate crystals)',
            origin: 'Southeast Asia (French Polynesia)',
            growthRate: 'Fast',
            maxSize: '6-10 ft trailing vines indoors',
            commonProblems: ['Brown spots from overwatering', 'Loss of variegation in low light', 'Root rot in soggy soil', 'Mealybugs on stems'],
            description: 'One of the most popular and forgiving houseplants, Golden Pothos features cascading vines with variegated green and gold heart-shaped leaves. It\'s an excellent air purifier, removing formaldehyde and benzene from indoor air. Native to Southeast Asia.',
            flower: 'Pothos almost never flowers in cultivation. In its native habitat, mature plants produce small, inconspicuous flowers enclosed in a green spathe, similar to other aroids. The flowers are rarely seen even in the wild, as the plant must reach full maturity on a tall tree.',
            careTips: [
                'Tolerates low light but grows faster in bright indirect light',
                'Let soil dry out between waterings — very drought tolerant',
                'Trim leggy vines to encourage bushier growth',
                'Propagates easily in water from stem cuttings',
                'Toxic to pets — keep out of reach of cats and dogs'
            ]
        },
        {
            id: 'snake-plant',
            name: 'Snake Plant',
            sciName: 'Dracaena trifasciata',
            icon: '🌵',
            category: ['indoor', 'succulent'],
            water: 'Every 14-21 days',
            waterDays: 17,
            light: 'Low to bright indirect',
            humidity: 'Low',
            temp: '55-85°F',
            difficulty: 'Very Easy',
            toxicity: 'Mildly toxic to pets (saponins)',
            origin: 'West Africa (Nigeria to Congo)',
            growthRate: 'Slow',
            maxSize: '2-4 ft indoors',
            commonProblems: ['Root rot from overwatering', 'Mushy leaves from cold temperatures', 'Scarring from physical damage', 'Fungal issues in humid conditions'],
            description: 'Also known as Mother-in-Law\'s Tongue, this striking plant features stiff, upright sword-like leaves with yellow or cream edges. It\'s one of the best air-purifying plants, notably producing oxygen at night. Native to West Africa.',
            flower: 'Snake plants can flower, though it\'s uncommon indoors. When they do bloom, they produce long, thin flower stalks bearing clusters of small, tubular, greenish-white or cream flowers. The blooms are intensely fragrant, especially at night, producing a sweet, vanilla-like scent. Flowering is often triggered by mild stress, such as being root-bound.',
            careTips: [
                'Extremely drought tolerant — err on the side of underwatering',
                'Well-draining soil is essential to prevent root rot',
                'Can survive in very low light conditions',
                'Wipe leaves occasionally to keep them clean',
                'Divide overcrowded plants in spring'
            ]
        },
        {
            id: 'fiddle-leaf',
            name: 'Fiddle Leaf Fig',
            sciName: 'Ficus lyrata',
            icon: '🌳',
            category: ['indoor'],
            water: 'Every 7-10 days',
            waterDays: 8,
            light: 'Bright indirect',
            humidity: 'Medium',
            temp: '60-75°F',
            difficulty: 'Moderate',
            toxicity: 'Mildly toxic to pets and humans (sap irritant)',
            origin: 'Western Africa (Sierra Leone to Cameroon)',
            growthRate: 'Moderate',
            maxSize: '6-10 ft indoors, 40+ ft in wild',
            commonProblems: ['Brown spots from inconsistent watering', 'Leaf drop from drafts or relocation', 'Root rot from poor drainage', 'Edema from overwatering'],
            description: 'The Fiddle Leaf Fig is a statement plant with large, violin-shaped, deeply veined leaves. It has become one of the most popular interior design plants. Native to western African lowland rainforests, it can grow into a small tree indoors.',
            flower: 'Fiddle Leaf Figs are flowering plants, but they essentially never bloom indoors. In their native tropical African habitat, they produce small, inconspicuous flowers hidden inside a fig-like structure (syconium). These develop into small green figs about 1 inch in diameter that are not considered edible.',
            careTips: [
                'Hates being moved — find a bright spot and leave it there',
                'Brown spots on leaves often indicate overwatering or root rot',
                'Dust leaves monthly for optimal photosynthesis',
                'Water when top 2 inches of soil are dry',
                'Sensitive to drafts and temperature changes'
            ]
        },
        {
            id: 'peace-lily',
            name: 'Peace Lily',
            sciName: 'Spathiphyllum wallisii',
            icon: '🤍',
            category: ['indoor', 'flowering'],
            water: 'Every 5-7 days',
            waterDays: 6,
            light: 'Low to medium indirect',
            humidity: 'Medium-High',
            temp: '65-80°F',
            difficulty: 'Easy',
            toxicity: 'Toxic to pets and humans (calcium oxalate crystals)',
            origin: 'Tropical Americas & Southeast Asia',
            growthRate: 'Moderate',
            maxSize: '1-4 ft indoors',
            commonProblems: ['Brown leaf tips from low humidity', 'Yellow leaves from overwatering', 'No blooms from insufficient light', 'Drooping from underwatering'],
            description: 'Peace Lilies are elegant plants with dark green, glossy leaves and distinctive white spathes that bloom multiple times per year. They\'re excellent air purifiers, removing ammonia, benzene, and formaldehyde. Native to tropical Americas and southeastern Asia.',
            flower: 'The Peace Lily\'s "flower" is actually a modified leaf called a spathe — a large, white, hood-shaped bract that surrounds a cream-colored spadix (the true flower cluster). The spadix contains many tiny flowers packed together. Blooms typically appear in spring and can last for weeks, gradually turning from pure white to pale green as they age. Peace Lilies are one of the few houseplants that bloom reliably in low light.',
            careTips: [
                'Will dramatically wilt when thirsty but recovers quickly after watering',
                'Brown leaf tips often indicate low humidity or mineral buildup',
                'Remove spent blooms to encourage new flowers',
                'Use filtered water if possible — sensitive to chlorine',
                'Toxic to pets — keep elevated or out of reach'
            ]
        },
        {
            id: 'aloe-vera',
            name: 'Aloe Vera',
            sciName: 'Aloe barbadensis miller',
            icon: '🌵',
            category: ['indoor', 'succulent'],
            water: 'Every 14-21 days',
            waterDays: 17,
            light: 'Bright direct/indirect',
            humidity: 'Low',
            temp: '55-80°F',
            difficulty: 'Easy',
            description: 'Aloe Vera is a succulent plant famous for the soothing gel inside its thick, fleshy leaves. Used for thousands of years in traditional medicine, it treats burns, cuts, and skin irritations. Easy to grow and practically indestructible with proper drainage.',
            flower: 'Mature Aloe Vera plants (typically 4+ years old) can produce a tall flower spike reaching 2-3 feet. The spike bears tubular flowers in stunning clusters, typically bright yellow, orange, or red. Blooms appear in late winter to spring and attract hummingbirds and bees. Indoor Aloe rarely flowers due to insufficient light — it needs intense direct sunlight and cool nighttime temperatures to trigger blooming.',
            careTips: [
                'Let soil dry completely between waterings',
                'Use a fast-draining cactus/succulent soil mix',
                'Needs at least 6 hours of bright light daily',
                'Harvest gel from outer, mature leaves only',
                'Offsets (pups) can be separated and repotted'
            ]
        },
        {
            id: 'orchid',
            name: 'Phalaenopsis Orchid',
            sciName: 'Phalaenopsis spp.',
            icon: '🌸',
            category: ['indoor', 'flowering'],
            water: 'Every 7-10 days',
            waterDays: 8,
            light: 'Bright indirect',
            humidity: 'Medium-High',
            temp: '65-80°F',
            difficulty: 'Moderate',
            description: 'Moth Orchids are the most common orchid houseplant, producing stunning arching sprays of long-lasting flowers. They come in nearly every color and pattern imaginable. Epiphytic in nature, they grow on tree branches in tropical Asian forests.',
            flower: 'Phalaenopsis orchids produce elegant, butterfly-shaped flowers on arching stems (racemes). Each flower has three sepals, two lateral petals, and a distinctive modified lip petal. Blooms can last 2-3 months and come in white, pink, purple, yellow, orange, and multicolored varieties. Some have spots, stripes, or gradients. After flowers drop, cut the spike above a node — it may rebloom from that point. A temperature drop of 10-15°F at night for 2-4 weeks triggers new spikes.',
            careTips: [
                'Water by soaking roots for 10-15 minutes, then drain completely',
                'Never let water sit in the crown — causes crown rot',
                'Bright indirect light — no direct sun which burns leaves',
                'Use orchid-specific bark-based potting mix, not soil',
                'Feed weakly, weekly with diluted orchid fertilizer'
            ]
        },
        {
            id: 'spider-plant',
            name: 'Spider Plant',
            sciName: 'Chlorophytum comosum',
            icon: '🌿',
            category: ['indoor'],
            water: 'Every 7-10 days',
            waterDays: 8,
            light: 'Bright indirect',
            humidity: 'Low-Medium',
            temp: '55-80°F',
            difficulty: 'Very Easy',
            description: 'Spider Plants are cheerful, adaptable plants with arching, variegated leaves and cascading baby plantlets. They\'re excellent air purifiers and nearly impossible to kill. A perfect choice for beginners and hanging baskets.',
            flower: 'Spider Plants produce small, delicate, star-shaped white flowers on long, arching stems (stolons). The flowers have six petals and appear in small clusters. While individually tiny and short-lived, they are charming and sweetly scented. After flowering, these stems develop the "spiderettes" (baby plants) that dangle below the mother plant, giving the Spider Plant its common name.',
            careTips: [
                'Brown leaf tips are common — usually from fluoride in tap water',
                'Use distilled or rainwater if possible',
                'Easily propagated by potting the dangling baby plants',
                'Tolerates a wide range of light conditions',
                'Safe for pets — non-toxic to cats and dogs'
            ]
        },
        {
            id: 'lavender',
            name: 'Lavender',
            sciName: 'Lavandula angustifolia',
            icon: '💜',
            category: ['outdoor', 'flowering', 'herb'],
            water: 'Every 7-14 days',
            waterDays: 10,
            light: 'Full sun',
            humidity: 'Low',
            temp: '60-80°F',
            difficulty: 'Moderate',
            description: 'Lavender is a beloved Mediterranean herb prized for its intensely fragrant purple flowers and silvery-green foliage. Used in aromatherapy, cooking, and crafts. It attracts pollinators and repels many garden pests. Extremely drought-tolerant once established.',
            flower: 'Lavender produces dense spikes of small, tubular flowers arranged in whorls around a central stem. Each tiny flower has two lips — the upper lip has two lobes and the lower has three. Colors range from deep violet to light purple, blue, pink, and white depending on variety. English lavender (angustifolia) has the most potent fragrance. Flowers bloom in early to mid-summer and are rich in essential oils. They retain their scent when dried and are used in sachets, baking, and herbal teas.',
            careTips: [
                'Needs at least 6-8 hours of direct sunlight',
                'Well-draining, slightly alkaline soil is essential',
                'Do not overwater — prefers dry conditions',
                'Prune after flowering to maintain shape and prevent woodiness',
                'Harvest flowers when buds have formed but haven\'t fully opened'
            ]
        },
        {
            id: 'basil',
            name: 'Sweet Basil',
            sciName: 'Ocimum basilicum',
            icon: '🌿',
            category: ['indoor', 'outdoor', 'herb'],
            water: 'Every 2-3 days',
            waterDays: 3,
            light: 'Full sun',
            humidity: 'Medium',
            temp: '70-90°F',
            difficulty: 'Easy',
            description: 'Sweet Basil is the king of culinary herbs, essential in Italian, Thai, and Vietnamese cuisines. Its aromatic leaves are rich in essential oils that provide a sweet, slightly peppery flavor. A warm-weather annual that grows quickly from seed.',
            flower: 'Basil produces spikes of small, tubular white or pale purple flowers arranged in terminal racemes. Each flower is about ¼ inch long with two lips. While pretty, allowing basil to flower causes the leaves to become bitter and the plant to stop producing new foliage. Most gardeners pinch off flower buds to extend the harvest. However, basil flowers are edible, attract pollinators, and can be used as a delicate garnish.',
            careTips: [
                'Pinch off flower buds to keep leaves flavorful and productive',
                'Harvest regularly by cutting stems above a leaf pair',
                'Needs 6-8 hours of sunlight and consistent moisture',
                'Never let soil dry out completely',
                'Pinch growing tips to encourage bushy growth'
            ]
        },
        {
            id: 'succulents',
            name: 'Echeveria',
            sciName: 'Echeveria spp.',
            icon: '🪷',
            category: ['indoor', 'succulent'],
            water: 'Every 10-14 days',
            waterDays: 12,
            light: 'Bright direct',
            humidity: 'Low',
            temp: '60-80°F',
            difficulty: 'Easy',
            description: 'Echeveria are rosette-forming succulents native to semi-desert regions of Central America. Their symmetrical rosettes come in beautiful shades of green, pink, purple, blue, and even almost black. Popular in terrariums and arrangements.',
            flower: 'Echeveria produce stunning bell-shaped flowers on arching stalks called inflorescences that rise above the rosette. Flowers come in bright coral, orange, pink, yellow, and red. Each bloom has five fused petals forming a lantern-like shape. Multiple flowers open sequentially along the stalk, providing weeks of color. The flowering stalk can reach 6-12 inches and often attracts hummingbirds outdoors.',
            careTips: [
                'Soak and dry method — water deeply then let soil dry completely',
                'Use gritty, well-draining succulent soil',
                'At least 4-6 hours of direct sunlight',
                'Remove dead lower leaves to prevent rot and pests',
                'Propagate from leaf cuttings or offsets'
            ]
        },
        {
            id: 'rosemary',
            name: 'Rosemary',
            sciName: 'Salvia rosmarinus',
            icon: '🌿',
            category: ['outdoor', 'herb'],
            water: 'Every 7-14 days',
            waterDays: 10,
            light: 'Full sun',
            humidity: 'Low',
            temp: '55-80°F',
            difficulty: 'Moderate',
            description: 'Rosemary is an evergreen Mediterranean shrub with intensely aromatic needle-like leaves. Used extensively in cooking (especially with roasted meats), medicine, and even as a natural insect repellent. Can live for decades with proper care.',
            flower: 'Rosemary produces clusters of small, two-lipped flowers that bloom along the woody stems. Flowers are typically pale blue to lavender, though pink and white varieties exist. Each flower is about ½ inch long and shaped like a tiny snapdragon. They bloom profusely in late winter to early spring and are excellent for pollinators, especially bees. Rosemary honey is a prized delicacy in Mediterranean regions.',
            careTips: [
                'Prefers dry, well-drained, slightly alkaline soil',
                'Needs at least 6 hours of direct sunlight daily',
                'Allow soil to dry between waterings — hates wet feet',
                'Prune regularly to maintain shape and encourage new growth',
                'Bring indoors in winter in cold climates (below zone 8)'
            ]
        },
        {
            id: 'sunflower',
            name: 'Sunflower',
            sciName: 'Helianthus annuus',
            icon: '🌻',
            category: ['outdoor', 'flowering'],
            water: 'Every 3-5 days',
            waterDays: 4,
            light: 'Full sun',
            humidity: 'Low-Medium',
            temp: '65-85°F',
            difficulty: 'Easy',
            description: 'Sunflowers are iconic annual plants known for their large, sunny flower heads that can reach over a foot in diameter. They exhibit heliotropism — young flower heads track the sun across the sky. Native to North America and cultivated for seeds, oil, and beauty.',
            flower: 'The sunflower "flower" is actually a composite head (capitulum) made up of hundreds to thousands of tiny individual flowers called florets. The outer ring consists of ray florets — each "petal" is a single flower — while the center disc contains hundreds of tiny disc florets arranged in mesmerizing Fibonacci spirals. Each disc floret produces one seed. The head can reach 6-12 inches across. Sunflowers come in yellow, orange, red, bronze, and bicolored varieties. Young flower heads track the sun (heliotropism) but face east permanently once mature.',
            careTips: [
                'Plant in full sun — minimum 6-8 hours direct light',
                'Deep, infrequent watering encourages strong root systems',
                'Tall varieties may need staking for wind support',
                'Deadhead spent flowers to encourage continued blooming',
                'Seeds are ready to harvest when the back of the head turns brown'
            ]
        },
        {
            id: 'rose',
            name: 'Rose',
            sciName: 'Rosa spp.',
            icon: '🌹',
            category: ['outdoor', 'flowering'],
            water: 'Every 3-5 days',
            waterDays: 4,
            light: 'Full sun',
            humidity: 'Medium',
            temp: '60-75°F',
            difficulty: 'Moderate',
            description: 'Roses are among the world\'s most celebrated flowers, with over 30,000 cultivated varieties spanning every color except true blue. They\'ve been cultivated for over 5,000 years for their beauty, fragrance, and symbolic meaning in nearly every culture.',
            flower: 'Rose flowers come in an extraordinary variety of forms — from simple 5-petaled wild species to opulent blooms with over 100 petals. The classic rose has layers of spiraling petals around a central point, creating the beloved cup or rosette shape. Colors include every shade from pure white through yellow, orange, pink, red, and deep burgundy, plus bicolors and color-changing varieties. Many roses are intensely fragrant, with scent profiles ranging from fruity to musky to tea-like. Hybrid tea roses produce single large blooms on long stems; floribundas produce clusters; climbers create cascading walls of flowers.',
            careTips: [
                'Morning sun and afternoon shade is ideal in hot climates',
                'Water deeply at the base — avoid wetting leaves to prevent disease',
                'Prune in late winter/early spring before new growth begins',
                'Deadhead regularly to encourage repeat blooming',
                'Watch for aphids, black spot, and powdery mildew'
            ]
        },
        {
            id: 'zz-plant',
            name: 'ZZ Plant',
            sciName: 'Zamioculcas zamiifolia',
            icon: '🌿',
            category: ['indoor'],
            water: 'Every 14-21 days',
            waterDays: 17,
            light: 'Low to bright indirect',
            humidity: 'Low',
            temp: '60-75°F',
            difficulty: 'Very Easy',
            description: 'The ZZ Plant is virtually indestructible, thriving on neglect with its glossy, dark green leaflets along upright stems. It stores water in potato-like rhizomes underground. Native to eastern Africa, it survives drought, low light, and irregular care.',
            flower: 'ZZ Plants can technically flower, but it\'s extremely rare indoors. When blooming occurs, they produce a small, yellowish-brown spathe and spadix at the base of the plant near the soil — similar to a tiny peace lily flower but much less showy. The bloom is easy to miss among the foliage. Flowering typically occurs on very mature plants and has no particular ornamental value.',
            careTips: [
                'Extremely drought tolerant — when in doubt, don\'t water',
                'Bright indirect light speeds growth but low light is fine',
                'Toxic if ingested — wash hands after handling',
                'Rarely needs repotting — happy being root-bound',
                'Propagate from leaf cuttings (very slow) or division'
            ]
        },
        {
            id: 'jade',
            name: 'Jade Plant',
            sciName: 'Crassula ovata',
            icon: '💚',
            category: ['indoor', 'succulent'],
            water: 'Every 10-14 days',
            waterDays: 12,
            light: 'Bright direct/indirect',
            humidity: 'Low',
            temp: '55-75°F',
            difficulty: 'Easy',
            description: 'The Jade Plant, or Money Plant, is a popular succulent with thick, oval, jewel-like leaves on woody stems that develops a tree-like form over time. A symbol of good luck and prosperity in many cultures. Can live for decades and become a family heirloom.',
            flower: 'Mature Jade Plants (5+ years old) can produce clusters of tiny, star-shaped flowers in white or pale pink. The flowers have five petals and a sweet fragrance. They bloom in winter when exposed to cooler nighttime temperatures and longer dark periods. Each cluster can contain dozens of individual flowers creating a delicate, cloud-like display. Getting Jade Plants to flower requires reducing watering and providing cool nights (around 55°F) in autumn.',
            careTips: [
                'Allow soil to dry completely between waterings',
                'Needs bright light — can tolerate some direct sun',
                'Avoid getting water on leaves to prevent rot',
                'Prune to maintain desired shape and encourage branching',
                'Propagates easily from stem or leaf cuttings'
            ]
        },
        {
            id: 'mint',
            name: 'Mint',
            sciName: 'Mentha spp.',
            icon: '🌿',
            category: ['indoor', 'outdoor', 'herb'],
            water: 'Every 2-3 days',
            waterDays: 3,
            light: 'Partial to full sun',
            humidity: 'Medium',
            temp: '55-70°F',
            difficulty: 'Very Easy',
            description: 'Mint is an incredibly vigorous herb with a refreshing, cooling flavor. Used in cooking, cocktails, teas, and medicine for thousands of years. It spreads aggressively via underground runners, so container growing is recommended.',
            flower: 'Mint produces small, tubular flowers arranged in whorls along terminal spikes. Flowers are typically lavender, pink, or white and appear in mid to late summer. Each tiny flower has four petals and is very attractive to bees and butterflies. Like basil, flowering affects leaf flavor, so many gardeners pinch off flower buds. However, mint flowers are edible and make a lovely garnish for desserts and drinks.',
            careTips: [
                'Grow in containers to prevent invasive spreading',
                'Keep soil consistently moist but not waterlogged',
                'Regular harvesting encourages bushy, compact growth',
                'Cut back after flowering to rejuvenate the plant',
                'Easily propagated from stem cuttings in water'
            ]
        },
        {
            id: 'rubber-plant',
            name: 'Rubber Plant',
            sciName: 'Ficus elastica',
            icon: '🌳',
            category: ['indoor'],
            water: 'Every 7-10 days',
            waterDays: 8,
            light: 'Bright indirect',
            humidity: 'Medium',
            temp: '60-80°F',
            difficulty: 'Easy',
            description: 'The Rubber Plant features large, thick, glossy leaves in dark green, burgundy, or variegated patterns. It was once a major source of natural rubber before being replaced by the Brazilian rubber tree. An excellent indoor tree that can reach the ceiling.',
            flower: 'Rubber Plants are fig relatives and produce flowers hidden inside small, fig-like structures. In the wild, they produce small yellowish-green figs that require specific fig wasps for pollination. Indoor Rubber Plants virtually never flower. The ornamental value is entirely in their spectacular large, glossy leaves that come in green, burgundy (\'Burgundy\'), and variegated (\'Tineke\', \'Ruby\') varieties.',
            careTips: [
                'Wipe leaves with a damp cloth to maintain their glossy appearance',
                'Let top inch of soil dry between waterings',
                'Drooping leaves indicate it needs water',
                'Prune to control size and encourage branching',
                'White latex sap can irritate skin — wear gloves when pruning'
            ]
        },
        {
            id: 'boston-fern',
            name: 'Boston Fern',
            sciName: 'Nephrolepis exaltata',
            icon: '🌿',
            category: ['indoor'],
            water: 'Every 3-5 days',
            waterDays: 4,
            light: 'Bright indirect',
            humidity: 'High',
            temp: '60-75°F',
            difficulty: 'Moderate',
            description: 'Boston Ferns are classic houseplants with gracefully arching, feathery fronds. They\'re superb air humidifiers and purifiers. A Victorian parlor favorite that remains one of the most popular hanging basket plants. Native to tropical regions worldwide.',
            flower: 'Ferns do not produce flowers — they are among the oldest plant groups on Earth and reproduce via spores rather than seeds. Boston Ferns produce tiny brown dots called sori on the undersides of their fronds. These sori contain sporangia that release microscopic spores. The lack of flowers is actually what makes ferns unique in the plant kingdom — they\'ve reproduced this way for over 360 million years, predating flowering plants by about 200 million years.',
            careTips: [
                'Mist daily or use a pebble tray — loves high humidity',
                'Never let the soil dry out completely',
                'Keep away from heating vents and drafts',
                'Trim brown fronds at the base to encourage new growth',
                'Ideal for bathrooms where humidity is naturally higher'
            ]
        },
        {
            id: 'jasmine',
            name: 'Jasmine',
            sciName: 'Jasminum spp.',
            icon: '🤍',
            category: ['indoor', 'outdoor', 'flowering'],
            water: 'Every 3-5 days',
            waterDays: 4,
            light: 'Full sun to bright indirect',
            humidity: 'Medium-High',
            temp: '60-75°F',
            difficulty: 'Moderate',
            description: 'Jasmine is treasured worldwide for its intoxicatingly sweet, romantic fragrance. A climbing or trailing vine with dark green leaves. Used in perfumery, jasmine tea, and traditional medicine. The national flower of several countries including the Philippines and Indonesia.',
            flower: 'Jasmine flowers are exquisite small, star-shaped blooms with 5-9 waxy petals. Most common jasmine (J. sambac and J. officinale) produces pure white flowers, though J. mesnyi has yellow blooms. The flowers open in the evening and release their famous heady, sweet fragrance through the night to attract moth pollinators. Arabian Jasmine (J. sambac) is used to make jasmine tea and leis. The scent is so prized that jasmine absolute is one of the most expensive ingredients in perfumery, requiring about 7.6 million flowers to produce just 1 kg of oil.',
            careTips: [
                'Provide a trellis or support for climbing varieties',
                'Needs cool winter rest (around 50°F) to trigger blooming',
                'Keep soil evenly moist during growing season',
                'Prune after flowering to maintain shape',
                'Feed monthly during growing season with balanced fertilizer'
            ]
        }
    ];

    // ─── Care Tips Database ───
    const CARE_TIPS = [
        {
            category: 'Watering Basics',
            icon: '💧',
            tips: [
                { title: 'The Soak & Dry Method', text: 'Water thoroughly until it drains from the bottom, then wait until the soil dries to the appropriate level before watering again. This encourages deep root growth.' },
                { title: 'Check Before Watering', text: 'Stick your finger 1-2 inches into the soil. If it feels dry, it\'s time to water. If still moist, wait a day or two. Most plants are killed by overwatering, not underwatering.' },
                { title: 'Water Quality Matters', text: 'Many plants are sensitive to chlorine and fluoride in tap water. Let tap water sit overnight before using, or use filtered/rainwater for sensitive species.' },
                { title: 'Morning Watering', text: 'Water in the morning when possible. This gives leaves time to dry during the day, reducing the risk of fungal diseases.' },
                { title: 'Drainage Is Essential', text: 'Always use pots with drainage holes. Sitting in water causes root rot, the #1 killer of houseplants. Use a saucer and empty it 30 minutes after watering.' }
            ]
        },
        {
            category: 'Light & Placement',
            icon: '☀️',
            tips: [
                { title: 'Understanding Light Levels', text: 'Direct sun: rays touch leaves. Bright indirect: near a window but no direct rays. Medium: a few feet from a window. Low light: far from windows or north-facing rooms.' },
                { title: 'Rotate Your Plants', text: 'Turn plants a quarter turn each week so all sides receive equal light. This prevents lopsided growth toward the light source.' },
                { title: 'Watch for Light Stress', text: 'Scorched brown patches = too much direct sun. Leggy, stretched growth with small leaves = not enough light. Pale or faded leaves = too much light for that species.' },
                { title: 'Window Direction Guide', text: 'South-facing: brightest, best for sun-lovers. East-facing: gentle morning sun, great for most plants. West-facing: strong afternoon sun. North-facing: lowest light, best for shade-tolerant species.' },
                { title: 'Seasonal Light Changes', text: 'Remember that light intensity and duration change with seasons. You may need to move plants closer to windows in winter or farther away in summer.' }
            ]
        },
        {
            category: 'Soil & Repotting',
            icon: '🪴',
            tips: [
                { title: 'When to Repot', text: 'Repot when roots circle the bottom of the pot, grow through drainage holes, or the plant dries out very quickly after watering. Spring is the best time for most plants.' },
                { title: 'Choosing Pot Size', text: 'Only go up one pot size (1-2 inches larger in diameter). Too large a pot holds excess moisture that can cause root rot.' },
                { title: 'Soil Mix Basics', text: 'Most houseplants: standard potting mix + perlite. Succulents/cacti: fast-draining gritty mix. Orchids: bark-based mix. Ferns: peat-rich moisture-retaining mix.' },
                { title: 'The Terracotta Advantage', text: 'Terracotta pots are porous and allow soil to breathe and dry faster. Great for plants prone to overwatering like succulents. Plastic retains moisture longer.' },
                { title: 'Post-Repotting Care', text: 'After repotting, water well and place in indirect light for a week. Don\'t fertilize for 4-6 weeks — fresh soil has nutrients and roots need time to recover.' }
            ]
        },
        {
            category: 'Feeding & Fertilizer',
            icon: '🌱',
            tips: [
                { title: 'Growing Season Feeding', text: 'Feed most houseplants monthly during spring and summer (growing season). Reduce or stop fertilizing in fall and winter when growth slows.' },
                { title: 'Less Is More', text: 'It\'s better to under-fertilize than over-fertilize. Excess fertilizer causes salt buildup that burns roots. When in doubt, dilute to half strength.' },
                { title: 'NPK Explained', text: 'N (Nitrogen) for leaf growth. P (Phosphorus) for roots and flowers. K (Potassium) for overall health. A balanced 10-10-10 works for most plants.' },
                { title: 'Signs of Nutrient Deficiency', text: 'Yellow lower leaves: nitrogen deficiency. Poor flowering: phosphorus deficiency. Weak stems: potassium deficiency. Yellowing between leaf veins: iron deficiency.' },
                { title: 'Organic Options', text: 'Diluted worm casting tea, fish emulsion, or compost tea are gentle, organic fertilizer options that are hard to over-apply.' }
            ]
        },
        {
            category: 'Pest Control',
            icon: '🐛',
            tips: [
                { title: 'Prevention First', text: 'Quarantine new plants for 2 weeks before placing near your collection. Inspect regularly and keep leaves clean — healthy plants resist pests better.' },
                { title: 'Common Houseplant Pests', text: 'Spider mites: tiny dots + webbing. Mealybugs: white cottony masses. Scale: brown bumps on stems. Fungus gnats: tiny flies in soil. Aphids: clusters on new growth.' },
                { title: 'Neem Oil Solution', text: 'Mix 1 tsp neem oil + ½ tsp dish soap + 1 quart warm water in a spray bottle. Apply weekly to affected plants. Effective against most common pests.' },
                { title: 'Rubbing Alcohol Treatment', text: 'Dab mealybugs and scale insects directly with a cotton swab soaked in 70% rubbing alcohol. This kills them on contact without harming most plants.' },
                { title: 'Sticky Traps for Gnats', text: 'Yellow sticky traps catch adult fungus gnats. Let soil dry out between waterings and top-dress with sand to break the breeding cycle.' }
            ]
        },
        {
            category: 'Propagation',
            icon: '✂️',
            tips: [
                { title: 'Stem Cutting Basics', text: 'Cut a 4-6 inch stem section just below a node (where leaves attach). Remove lower leaves. Place in water or moist soil. Keep warm and in indirect light.' },
                { title: 'Water Propagation', text: 'Place cuttings in a clean jar of water, changing water weekly. Wait for roots to grow 2-3 inches long before potting in soil. Works great for pothos, philodendron, and tradescantia.' },
                { title: 'Leaf Propagation', text: 'Many succulents propagate from single leaves. Gently twist a healthy leaf off, let it callous for 2-3 days, then place on moist soil. Mist occasionally. Baby plants appear in weeks.' },
                { title: 'Division Method', text: 'For plants that grow in clumps (snake plants, peace lilies, ferns), unpot and gently separate into sections, each with roots. Repot sections individually.' },
                { title: 'Rooting Hormone', text: 'Dipping cut ends in rooting hormone powder increases success rates, especially for woody or slow-rooting plants. Not necessary but helpful for difficult species.' }
            ]
        },
        {
            category: 'Seasonal Care',
            icon: '🍂',
            tips: [
                { title: 'Winter Adjustments', text: 'Reduce watering frequency — plants grow slower and use less water. Stop fertilizing. Move away from cold windows and heating vents. Increase humidity (heating dries indoor air).' },
                { title: 'Spring Wake-Up', text: 'Gradually increase watering as days lengthen. Resume monthly fertilizing. This is the best time to repot, prune, and propagate. Check for overwintering pests.' },
                { title: 'Summer Care', text: 'Watch for increased water needs. Provide shade for plants that get too much direct summer sun. Great time to move houseplants outdoors (acclimate gradually).' },
                { title: 'Fall Preparation', text: 'Bring outdoor plants inside before first frost. Reduce watering and stop fertilizing. Check for pests hitchhiking indoors. Clean and prune before winter dormancy.' },
                { title: 'Humidity in Winter', text: 'Group plants together to create a microclimate. Use pebble trays with water. Run a humidifier nearby. Mist tropical plants in the morning.' }
            ]
        },
        {
            category: 'Flower Care',
            icon: '🌸',
            tips: [
                { title: 'Triggering Blooms', text: 'Many plants need specific conditions to flower: cooler nighttime temps, shorter day length, slight drought stress, or being root-bound. Research your specific plant\'s bloom triggers.' },
                { title: 'Deadheading', text: 'Remove spent flowers promptly. This redirects energy from seed production back to making new flowers, extending the blooming period significantly.' },
                { title: 'Phosphorus for Flowers', text: 'Switch to a high-phosphorus fertilizer (like 10-30-20) when you want to encourage blooming. Phosphorus is the key nutrient for flower production.' },
                { title: 'Light for Flowering', text: 'Most flowering plants need more light than foliage plants. If your plant won\'t bloom, try giving it more bright light. Some need specific photoperiods (hours of darkness).' },
                { title: 'Patience with New Plants', text: 'Many plants need to reach a certain age or size before flowering. Orchids may skip a year adjusting to your home. Jade plants may take 5+ years. Don\'t give up!' }
            ]
        }
    ];

    // ─── State ───
    let state = {
        myPlants: [],
        journal: [],
        darkMode: false,
        notifSound: true
    };

    // ─── Utility Functions ───
    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    }

    function saveState() {
        localStorage.setItem('plantopia_state', JSON.stringify(state));
    }

    function loadState() {
        const saved = localStorage.getItem('plantopia_state');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                state = { ...state, ...parsed };
            } catch (e) { /* ignore corrupt data */ }
        }
    }

    function showToast(msg) {
        const toast = $('#toast');
        const toastMsg = $('#toastMsg');
        toastMsg.textContent = msg;
        toast.classList.remove('hidden');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => toast.classList.add('hidden'), 2500);
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function daysUntilWater(plant) {
        if (!plant.lastWatered) return 0;
        const last = new Date(plant.lastWatered + 'T00:00:00');
        const next = new Date(last);
        next.setDate(next.getDate() + plant.waterDays);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diff = Math.ceil((next - today) / (1000 * 60 * 60 * 24));
        return diff;
    }

    function todayStr() {
        const d = new Date();
        return d.toISOString().split('T')[0];
    }

    function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(id) {
        document.getElementById(id).classList.add('hidden');
        document.body.style.overflow = '';
    }

    function confirmDialog(msg) {
        return new Promise((resolve) => {
            $('#confirmMsg').textContent = msg;
            openModal('modalConfirm');
            const okBtn = $('#confirmOk');
            const cancelBtn = $('#confirmCancel');
            function cleanup() {
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                closeModal('modalConfirm');
            }
            function onOk() { cleanup(); resolve(true); }
            function onCancel() { cleanup(); resolve(false); }
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
        });
    }

    function getPlantIcon(plant) {
        if (plant.speciesId) {
            const lib = PLANT_LIBRARY.find(p => p.id === plant.speciesId);
            if (lib) return lib.icon;
        }
        return '🌱';
    }

    function getPlantBgColor(index) {
        const colors = ['#d8f3dc', '#b7e4c7', '#95d5b2', '#74c69d', '#e8f5e9', '#c8e6c9', '#dcedc8', '#f0f4c3'];
        return colors[index % colors.length];
    }

    // ─── Render: My Plants ───
    function renderMyPlants() {
        const grid = $('#myPlantsGrid');
        const empty = $('#emptyMyPlants');

        if (state.myPlants.length === 0) {
            grid.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        grid.classList.remove('hidden');
        empty.classList.add('hidden');

        grid.innerHTML = state.myPlants.map((plant, i) => {
            const days = daysUntilWater(plant);
            let badgeClass = '';
            if (days <= 0) badgeClass = 'needs-water';
            else if (days <= 2) badgeClass = 'soon';
            const bgColor = getPlantBgColor(i);

            return `
                <div class="plant-card" data-id="${plant.id}" onclick="window.app.openPlantDetail('${plant.id}')">
                    <div class="water-badge ${badgeClass}"></div>
                    <div class="plant-card-icon" style="background:${document.body.classList.contains('dark') ? 'var(--bg-card-hover)' : bgColor}">
                        ${getPlantIcon(plant)}
                    </div>
                    <h4>${escapeHtml(plant.name)}</h4>
                    <p class="plant-species">${escapeHtml(plant.species || '')}</p>
                </div>
            `;
        }).join('');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─── Render: Plant Detail ───
    window.app = {};

    window.app.openPlantDetail = function (id) {
        const plant = state.myPlants.find(p => p.id === id);
        if (!plant) return;

        $('#detailPlantName').textContent = plant.name;
        const days = daysUntilWater(plant);
        let waterStatus = '';
        let waterColor = 'var(--green)';
        if (days <= 0) { waterStatus = 'Needs water now!'; waterColor = 'var(--danger)'; }
        else if (days === 1) { waterStatus = 'Water tomorrow'; waterColor = 'var(--accent)'; }
        else if (days <= 3) { waterStatus = `Water in ${days} days`; waterColor = 'var(--accent)'; }
        else { waterStatus = `Water in ${days} days`; }

        const libInfo = plant.speciesId ? PLANT_LIBRARY.find(p => p.id === plant.speciesId) : null;

        let html = `
            <div class="detail-plant-icon">
                <div class="plant-icon-large">${getPlantIcon(plant)}</div>
            </div>
            <div class="detail-info-grid">
                <div class="detail-info-box">
                    <div class="label">Location</div>
                    <div class="value">${escapeHtml(plant.location || 'Not set')}</div>
                </div>
                <div class="detail-info-box">
                    <div class="label">Water Every</div>
                    <div class="value">${plant.waterDays} days</div>
                </div>
                <div class="detail-info-box">
                    <div class="label">Last Watered</div>
                    <div class="value">${formatDate(plant.lastWatered)}</div>
                </div>
                <div class="detail-info-box">
                    <div class="label">Next Water</div>
                    <div class="value" style="color:${waterColor}">${waterStatus}</div>
                </div>
            </div>
        `;

        if (plant.notes) {
            html += `<div class="lib-detail-section"><h4>Notes</h4><p>${escapeHtml(plant.notes)}</p></div>`;
        }

        if (libInfo) {
            html += `<div class="lib-detail-section"><h4>Species Info</h4><p><em>${escapeHtml(libInfo.sciName)}</em> — ${escapeHtml(libInfo.description.substring(0, 120))}... <a href="#" onclick="event.preventDefault(); window.app.closeAndOpenLib('${libInfo.id}')">Read more</a></p></div>`;
        }

        html += `
            <div class="detail-actions">
                <button class="btn-primary" onclick="window.app.waterPlant('${plant.id}')">💧 Water Now</button>
                <button class="btn-outline" onclick="window.app.editPlant('${plant.id}')">✏️ Edit</button>
                <button class="btn-danger" onclick="window.app.deletePlant('${plant.id}')">🗑️</button>
            </div>
        `;

        $('#plantDetailBody').innerHTML = html;
        openModal('modalPlantDetail');
    };

    window.app.closeAndOpenLib = function (libId) {
        closeModal('modalPlantDetail');
        setTimeout(() => window.app.openLibraryDetail(libId), 300);
    };

    window.app.waterPlant = function (id) {
        const plant = state.myPlants.find(p => p.id === id);
        if (!plant) return;
        plant.lastWatered = todayStr();
        saveState();
        closeModal('modalPlantDetail');
        renderMyPlants();
        renderSchedule();
        showToast(`💧 ${plant.name} watered!`);
        if (state.notifSound) playWaterSound();
    };

    window.app.editPlant = function (id) {
        const plant = state.myPlants.find(p => p.id === id);
        if (!plant) return;
        closeModal('modalPlantDetail');
        setTimeout(() => {
            $('#addPlantTitle').textContent = 'Edit Plant';
            $('#plantFormSubmit').textContent = 'Save Changes';
            $('#plantEditId').value = id;
            $('#plantName').value = plant.name;
            $('#plantSpecies').value = plant.speciesId || '';
            $('#plantLocation').value = plant.location || 'indoor';
            $('#plantWaterDays').value = plant.waterDays;
            $('#plantLastWatered').value = plant.lastWatered || '';
            $('#plantNotes').value = plant.notes || '';
            openModal('modalAddPlant');
        }, 300);
    };

    window.app.deletePlant = async function (id) {
        const plant = state.myPlants.find(p => p.id === id);
        if (!plant) return;
        const ok = await confirmDialog(`Delete "${plant.name}"? This cannot be undone.`);
        if (!ok) return;
        state.myPlants = state.myPlants.filter(p => p.id !== id);
        saveState();
        closeModal('modalPlantDetail');
        renderMyPlants();
        renderSchedule();
        showToast(`${plant.name} removed`);
    };

    // ─── Render: Plant Library ───
    function renderLibrary(filter, search) {
        filter = filter || 'all';
        search = (search || '').toLowerCase().trim();
        const grid = $('#libraryGrid');

        let plants = PLANT_LIBRARY;
        if (filter !== 'all') {
            plants = plants.filter(p => p.category.includes(filter));
        }
        if (search) {
            plants = plants.filter(p =>
                p.name.toLowerCase().includes(search) ||
                p.sciName.toLowerCase().includes(search) ||
                p.description.toLowerCase().includes(search)
            );
        }

        if (plants.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No plants found</p></div>';
            return;
        }

        grid.innerHTML = plants.map(plant => {
            const tags = plant.category.map(c =>
                `<span class="lib-tag">${c}</span>`
            ).join('');
            return `
                <div class="library-card" onclick="window.app.openLibraryDetail('${plant.id}')">
                    <div class="library-card-icon">${plant.icon}</div>
                    <div class="library-card-info">
                        <h4>${escapeHtml(plant.name)}</h4>
                        <p>${escapeHtml(plant.sciName)}</p>
                        <div class="lib-tags">${tags}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    window.app.openLibraryDetail = function (id) {
        const plant = PLANT_LIBRARY.find(p => p.id === id);
        if (!plant) return;

        $('#libDetailName').textContent = plant.name;

        const tipsHtml = plant.careTips.map(t => `<li>${escapeHtml(t)}</li>`).join('');
        const alreadyAdded = state.myPlants.some(p => p.speciesId === id);

        let html = `
            <div class="lib-detail-hero">
                <div class="lib-icon-lg">${plant.icon}</div>
                <h2>${escapeHtml(plant.name)}</h2>
                <p class="sci-name">${escapeHtml(plant.sciName)}</p>
            </div>
            <div class="care-grid">
                <div class="care-box"><div class="care-icon">💧</div><div class="care-label">Water</div><div class="care-value">${plant.water}</div></div>
                <div class="care-box"><div class="care-icon">☀️</div><div class="care-label">Light</div><div class="care-value">${plant.light}</div></div>
                <div class="care-box"><div class="care-icon">💨</div><div class="care-label">Humidity</div><div class="care-value">${plant.humidity}</div></div>
                <div class="care-box"><div class="care-icon">🌡️</div><div class="care-label">Temperature</div><div class="care-value">${plant.temp}</div></div>
                <div class="care-box"><div class="care-icon">📊</div><div class="care-label">Difficulty</div><div class="care-value">${plant.difficulty}</div></div>
                <div class="care-box"><div class="care-icon">📋</div><div class="care-label">Category</div><div class="care-value">${plant.category.join(', ')}</div></div>
            </div>
            <div class="lib-detail-section">
                <h4>About</h4>
                <p>${escapeHtml(plant.description)}</p>
            </div>
            <div class="lib-detail-section">
                <h4>🌸 Flowers & Blooming</h4>
                <p>${escapeHtml(plant.flower)}</p>
            </div>
            <div class="lib-detail-section">
                <h4>Care Tips</h4>
                <ul style="padding-left:18px;color:var(--text-secondary);font-size:0.9rem;line-height:1.8;">${tipsHtml}</ul>
            </div>
            <div class="lib-detail-btn">
                <button class="btn-primary btn-full" onclick="window.app.addFromLibrary('${plant.id}')" ${alreadyAdded ? 'disabled style="opacity:0.5"' : ''}>
                    ${alreadyAdded ? '✓ Already in My Plants' : '➕ Add to My Plants'}
                </button>
            </div>
        `;

        $('#libraryDetailBody').innerHTML = html;
        openModal('modalLibraryDetail');
    };

    window.app.addFromLibrary = function (libId) {
        const libPlant = PLANT_LIBRARY.find(p => p.id === libId);
        if (!libPlant) return;
        if (state.myPlants.some(p => p.speciesId === libId)) {
            showToast('Already in your plants!');
            return;
        }
        const newPlant = {
            id: generateId(),
            name: libPlant.name,
            species: libPlant.sciName,
            speciesId: libId,
            location: libPlant.category.includes('outdoor') ? 'outdoor' : 'indoor',
            waterDays: libPlant.waterDays,
            lastWatered: todayStr(),
            notes: ''
        };
        state.myPlants.push(newPlant);
        saveState();
        closeModal('modalLibraryDetail');
        renderMyPlants();
        renderSchedule();
        showToast(`${libPlant.name} added to your plants! 🌱`);
    };

    // ─── Render: Schedule ───
    function renderSchedule() {
        const todayEl = $('#todayTasks');
        const upcomingEl = $('#upcomingTasks');
        const empty = $('#emptySchedule');
        const todaySection = $('.schedule-today');
        const upcomingSection = $('.schedule-upcoming');

        if (state.myPlants.length === 0) {
            todaySection.classList.add('hidden');
            upcomingSection.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        todaySection.classList.remove('hidden');
        upcomingSection.classList.remove('hidden');

        const todayTasks = [];
        const upcoming = [];

        state.myPlants.forEach(plant => {
            const days = daysUntilWater(plant);
            const task = { plant, days };
            if (days <= 0) todayTasks.push(task);
            else if (days <= 7) upcoming.push(task);
        });

        todayTasks.sort((a, b) => a.days - b.days);
        upcoming.sort((a, b) => a.days - b.days);

        if (todayTasks.length === 0) {
            todayEl.innerHTML = '<p style="padding:12px;color:var(--text-light);font-size:0.9rem;">All plants are happy! No watering needed today. 🎉</p>';
        } else {
            todayEl.innerHTML = todayTasks.map(t => {
                const overdue = t.days < 0;
                return `
                    <div class="task-item ${overdue ? 'overdue' : 'today'}">
                        <div class="task-icon">${getPlantIcon(t.plant)}</div>
                        <div class="task-info">
                            <h4>${escapeHtml(t.plant.name)}</h4>
                            <p>${overdue ? `${Math.abs(t.days)} day${Math.abs(t.days) > 1 ? 's' : ''} overdue` : 'Due today'}</p>
                        </div>
                        <button class="task-action" onclick="window.app.quickWater('${t.plant.id}')">💧 Water</button>
                    </div>
                `;
            }).join('');
        }

        if (upcoming.length === 0) {
            upcomingEl.innerHTML = '<p style="padding:12px;color:var(--text-light);font-size:0.9rem;">No upcoming tasks this week.</p>';
        } else {
            upcomingEl.innerHTML = upcoming.map(t => `
                <div class="task-item upcoming-task">
                    <div class="task-icon">${getPlantIcon(t.plant)}</div>
                    <div class="task-info">
                        <h4>${escapeHtml(t.plant.name)}</h4>
                        <p>In ${t.days} day${t.days > 1 ? 's' : ''}</p>
                    </div>
                    <button class="task-action" onclick="window.app.quickWater('${t.plant.id}')">💧 Water</button>
                </div>
            `).join('');
        }
    }

    window.app.quickWater = function (id) {
        const plant = state.myPlants.find(p => p.id === id);
        if (!plant) return;
        plant.lastWatered = todayStr();
        saveState();
        renderMyPlants();
        renderSchedule();
        showToast(`💧 ${plant.name} watered!`);
        if (state.notifSound) playWaterSound();
    };

    // ─── Render: Journal ───
    function renderJournal() {
        const list = $('#journalEntries');
        const empty = $('#emptyJournal');

        if (state.journal.length === 0) {
            list.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        list.classList.remove('hidden');
        empty.classList.add('hidden');

        const sorted = [...state.journal].sort((a, b) => new Date(b.date) - new Date(a.date));

        list.innerHTML = sorted.map(entry => {
            const plant = state.myPlants.find(p => p.id === entry.plantId);
            const plantName = plant ? plant.name : 'Unknown Plant';
            const moodLabels = { thriving: '🌿 Thriving', good: '🌱 Good', okay: '☘️ Okay', struggling: '🍂 Struggling', critical: '🥀 Critical' };
            const photoHtml = entry.photo ? `<img class="journal-photo" src="${entry.photo}" alt="Plant photo">` : '';

            return `
                <div class="journal-card">
                    <div class="journal-card-header">
                        <h4>${escapeHtml(plantName)}</h4>
                        <span class="journal-date">${formatDate(entry.date)}</span>
                    </div>
                    <div class="journal-health">${moodLabels[entry.mood] || '☘️ Okay'}</div>
                    ${photoHtml}
                    <p class="journal-notes">${escapeHtml(entry.notes)}</p>
                    <div class="journal-actions">
                        <button class="btn-icon" title="Delete" onclick="window.app.deleteJournal('${entry.id}')">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--danger)" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    window.app.deleteJournal = async function (id) {
        const ok = await confirmDialog('Delete this journal entry?');
        if (!ok) return;
        state.journal = state.journal.filter(j => j.id !== id);
        saveState();
        renderJournal();
        showToast('Entry deleted');
    };

    // ─── Render: Care Tips ───
    function renderTips() {
        const container = $('#tipsCategoryList');
        container.innerHTML = CARE_TIPS.map((cat, ci) => {
            const tipsHtml = cat.tips.map(tip => `
                <div class="tip-item">
                    <strong>${escapeHtml(tip.title)}</strong>
                    ${escapeHtml(tip.text)}
                </div>
            `).join('');

            return `
                <div class="tip-category" data-catidx="${ci}">
                    <div class="tip-category-header" onclick="window.app.toggleTipCategory(${ci})">
                        <div class="tip-category-icon">${cat.icon}</div>
                        <h4>${escapeHtml(cat.category)}</h4>
                        <svg class="tip-category-arrow" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                    <div class="tip-list">${tipsHtml}</div>
                </div>
            `;
        }).join('');
    }

    window.app.toggleTipCategory = function (idx) {
        const el = document.querySelector(`.tip-category[data-catidx="${idx}"]`);
        if (el) el.classList.toggle('open');
    };

    // ─── Sound Effects ───
    function playWaterSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.2);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) { /* silently fail if Web Audio not available */ }
    }

    // ─── Initialize ───
    function init() {
        loadState();

        // Populate species select
        const speciesSelect = $('#plantSpecies');
        PLANT_LIBRARY.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.sciName})`;
            speciesSelect.appendChild(opt);
        });

        // Set defaults
        $('#plantLastWatered').value = todayStr();
        $('#journalDate').value = todayStr();

        // Apply dark mode
        if (state.darkMode) {
            document.body.classList.add('dark');
            $('#darkModeToggle').checked = true;
        }
        $('#notifSoundToggle').checked = state.notifSound;

        // Initial renders
        renderMyPlants();
        renderLibrary('all', '');
        renderSchedule();
        renderJournal();
        renderTips();

        // ─── Event Listeners ───

        // Navigation
        $$('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                $$('.tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Add Plant Button
        $('#addPlantBtn').addEventListener('click', () => {
            $('#addPlantTitle').textContent = 'Add Plant';
            $('#plantFormSubmit').textContent = 'Add Plant';
            $('#plantForm').reset();
            $('#plantEditId').value = '';
            $('#plantLastWatered').value = todayStr();
            $('#plantWaterDays').value = 7;
            openModal('modalAddPlant');
        });

        // Plant Form Submit
        $('#plantForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const editId = $('#plantEditId').value;
            const name = $('#plantName').value.trim();
            const speciesId = $('#plantSpecies').value;
            const location = $('#plantLocation').value;
            const waterDays = parseInt($('#plantWaterDays').value) || 7;
            const lastWatered = $('#plantLastWatered').value || todayStr();
            const notes = $('#plantNotes').value.trim();

            if (!name) { showToast('Please enter a plant name'); return; }
            if (waterDays < 1 || waterDays > 60) { showToast('Water interval must be 1-60 days'); return; }

            const speciesInfo = PLANT_LIBRARY.find(p => p.id === speciesId);

            if (editId) {
                const plant = state.myPlants.find(p => p.id === editId);
                if (plant) {
                    plant.name = name;
                    plant.speciesId = speciesId;
                    plant.species = speciesInfo ? speciesInfo.sciName : '';
                    plant.location = location;
                    plant.waterDays = waterDays;
                    plant.lastWatered = lastWatered;
                    plant.notes = notes;
                    showToast('Plant updated! ✏️');
                }
            } else {
                state.myPlants.push({
                    id: generateId(),
                    name,
                    species: speciesInfo ? speciesInfo.sciName : '',
                    speciesId,
                    location,
                    waterDays,
                    lastWatered,
                    notes
                });
                showToast(`${name} added! 🌱`);
            }

            saveState();
            closeModal('modalAddPlant');
            renderMyPlants();
            renderSchedule();
            updateJournalPlantSelect();
        });

        // Library search
        $('#librarySearch').addEventListener('input', (e) => {
            const activeFilter = document.querySelector('#libraryFilters .chip.active');
            renderLibrary(activeFilter ? activeFilter.dataset.filter : 'all', e.target.value);
        });

        // Library filter chips
        $('#libraryFilters').addEventListener('click', (e) => {
            const chip = e.target.closest('.chip');
            if (!chip) return;
            $$('#libraryFilters .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderLibrary(chip.dataset.filter, $('#librarySearch').value);
        });

        // Journal button
        $('#addJournalBtn').addEventListener('click', () => {
            updateJournalPlantSelect();
            $('#journalForm').reset();
            $('#journalDate').value = todayStr();
            // Reset mood
            $$('.mood-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.mood-btn[data-mood="okay"]').classList.add('active');
            // Reset photo
            $('#photoPreview').classList.add('hidden');
            $('.photo-add-btn').classList.remove('hidden');
            $('#photoPreviewImg').src = '';

            if (state.myPlants.length === 0) {
                showToast('Add a plant first!');
                return;
            }
            openModal('modalJournalEntry');
        });

        function updateJournalPlantSelect() {
            const sel = $('#journalPlant');
            sel.innerHTML = '<option value="">Select a plant</option>';
            state.myPlants.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                sel.appendChild(opt);
            });
        }

        // Mood selector
        $('#journalMood').addEventListener('click', (e) => {
            const btn = e.target.closest('.mood-btn');
            if (!btn) return;
            $$('.mood-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });

        // Photo upload
        $('#photoAddBtn').addEventListener('click', () => {
            $('#journalPhoto').click();
        });

        $('#journalPhoto').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showToast('Please select an image file');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                showToast('Image too large (max 5MB)');
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                $('#photoPreviewImg').src = ev.target.result;
                $('#photoPreview').classList.remove('hidden');
                $('.photo-add-btn').classList.add('hidden');
            };
            reader.readAsDataURL(file);
        });

        $('#photoRemoveBtn').addEventListener('click', () => {
            $('#photoPreviewImg').src = '';
            $('#photoPreview').classList.add('hidden');
            $('.photo-add-btn').classList.remove('hidden');
            $('#journalPhoto').value = '';
        });

        // Journal form submit
        $('#journalForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const plantId = $('#journalPlant').value;
            const date = $('#journalDate').value || todayStr();
            const activeMood = document.querySelector('.mood-btn.active');
            const mood = activeMood ? activeMood.dataset.mood : 'okay';
            const notes = $('#journalNotes').value.trim();
            const photo = $('#photoPreviewImg').src || '';

            if (!plantId) { showToast('Please select a plant'); return; }
            if (!notes) { showToast('Please add some notes'); return; }

            state.journal.push({
                id: generateId(),
                plantId,
                date,
                mood,
                notes,
                photo: photo && photo !== window.location.href ? photo : ''
            });

            saveState();
            closeModal('modalJournalEntry');
            renderJournal();
            showToast('Journal entry saved! 📝');
        });

        // Settings
        $('#settingsBtn').addEventListener('click', () => openModal('modalSettings'));

        $('#darkModeToggle').addEventListener('change', (e) => {
            state.darkMode = e.target.checked;
            document.body.classList.toggle('dark', state.darkMode);
            saveState();
            renderMyPlants(); // re-render for bg color updates
        });

        $('#notifSoundToggle').addEventListener('change', (e) => {
            state.notifSound = e.target.checked;
            saveState();
        });

        $('#exportDataBtn').addEventListener('click', () => {
            const data = JSON.stringify(state, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'plantopia-backup.json';
            a.click();
            URL.revokeObjectURL(url);
            showToast('Data exported! 📁');
        });

        $('#clearDataBtn').addEventListener('click', async () => {
            const ok = await confirmDialog('Clear all data? This cannot be undone!');
            if (!ok) return;
            state.myPlants = [];
            state.journal = [];
            saveState();
            renderMyPlants();
            renderSchedule();
            renderJournal();
            updateJournalPlantSelect();
            closeModal('modalSettings');
            showToast('All data cleared');
        });

        // Modal close buttons
        $$('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.close;
                if (modalId) closeModal(modalId);
            });
        });

        // Close modals on overlay click
        $$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            });
        });

        // Splash screen
        setTimeout(() => {
            const splash = $('#splash');
            splash.classList.add('fade-out');
            $('#app').classList.remove('hidden');
            setTimeout(() => splash.remove(), 500);
        }, 1800);
    }

    // Start app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
