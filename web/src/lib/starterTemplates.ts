// Starter templates for the Create screen: 19 of the 30 entries in the Android app's assets/templates/catalog.json.
// The other 11 are left out on purpose: they are other people's raw prompts (a wallet address, a person's name, a forked
// app credited to a named user, one-word or non-English or device-specific prompts) or a duplicate. Two titles lose a stray
// 'N ' prefix. Only the fields the web uses are kept; `creator` is dropped because it names a real person on every card.
// A template just seeds the prompt with `description`; no project files are involved. Keep in step with the catalog
// (src/lib/starterTemplates.test.mts compares them when the android/ folder is present).

export interface StarterTemplate {
  slug: string;
  title: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  category: string;
  description: string;
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    slug: "saas-landing-page",
    title: "SaaS Landing Page",
    difficulty: "Beginner",
    category: "Layouts",
    description: "Build a SaaS landing page with animated hero, feature cards, pricing table, testimonial carousel, FAQ accordion, and a call-to-action with email signup",
  },
  {
    slug: "drawing-app",
    title: "Drawing App",
    difficulty: "Beginner",
    category: "Games & Canvas",
    description: "Build a drawing app with brush tools, color picker, undo/redo, layer support, canvas resize, and the ability to save artwork as PNG",
  },
  {
    slug: "social-media-feed",
    title: "Social Media Feed",
    difficulty: "Beginner",
    category: "Mobile UIs",
    description: "Build a social media feed with post cards, like/comment interactions, user avatars, infinite scroll, stories bar at top, and a modern Instagram-inspired layout",
  },
  {
    slug: "kanban-style-task-manager",
    title: "Kanban-style Task Manager",
    difficulty: "Beginner",
    category: "Productivity",
    description: "Build a Kanban-style task manager with drag and drop columns (To Do, In Progress, Done), ability to add/edit/delete tasks, priority labels, and local storage persistence",
  },
  {
    slug: "markdown-notes-app",
    title: "Markdown Notes App",
    difficulty: "Beginner",
    category: "Productivity",
    description: "Build a markdown notes app with sidebar navigation, rich text editing, tag-based organization, search functionality, and a Notion-inspired minimal design",
  },
  {
    slug: "smart-grocery-list-app",
    title: "Smart Grocery List App",
    difficulty: "Beginner",
    category: "Productivity",
    description: "Build a smart grocery list app with category grouping, quantity adjusters, check-off items, frequently bought suggestions, and a fresh produce-themed design",
  },
  {
    slug: "pixel-art-editor",
    title: "Pixel Art Editor",
    difficulty: "Beginner",
    category: "Games & Canvas",
    description: "Build a pixel art editor with grid canvas, color palette, brush and fill tools, animation frames, export as sprite sheet, and a retro 8-bit themed interface",
  },
  {
    slug: "personal-budget-planner",
    title: "Personal Budget Planner",
    difficulty: "Beginner",
    category: "Finance",
    description: "Build a personal budget planner with income and expense tracking, category breakdowns with pie charts, monthly summaries, savings goals, and a clean modern UI",
  },
  {
    slug: "personal-portfolio-website",
    title: "Personal Portfolio Website",
    difficulty: "Beginner",
    category: "Layouts",
    description: "Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, skills section, and a working contact form",
  },
  {
    slug: "n-invoice-generator",
    title: "Invoice Generator",
    difficulty: "Beginner",
    category: "Forms & Input",
    description: "Build an invoice generator with client details form, line item table, tax calculations, PDF preview, and a professional business-themed design",
  },
  {
    slug: "resume-builder",
    title: "Resume Builder",
    difficulty: "Beginner",
    category: "Forms & Input",
    description: "Build a resume builder with form sections for experience, education, and skills, live preview, multiple template choices, and PDF-style export view",
  },
  {
    slug: "photo-gallery",
    title: "Photo Gallery",
    difficulty: "Intermediate",
    category: "Mobile UIs",
    description: "Build a photo gallery with masonry grid layout, lightbox viewer, album organization, drag-and-drop upload, and smooth transition animations",
  },
  {
    slug: "community-event-board",
    title: "Community Event Board",
    difficulty: "Intermediate",
    category: "Layouts",
    description: "Build a community event board with event cards, date filtering, category tags, RSVP buttons, map location previews, and a vibrant poster-style design",
  },
  {
    slug: "real-time-chat-interface",
    title: "Real-time Chat Interface",
    difficulty: "Intermediate",
    category: "Mobile UIs",
    description: "Build a real-time chat interface with message bubbles, typing indicators, emoji picker, file attachment previews, and a clean WhatsApp-inspired design",
  },
  {
    slug: "n-interactive-quiz-game",
    title: "Interactive Quiz Game",
    difficulty: "Intermediate",
    category: "Games & Canvas",
    description: "Build an interactive quiz game with multiple choice questions, score tracking, timer, progress bar, results screen with share button, and colorful animations",
  },
  {
    slug: "pet-care-tracker",
    title: "Pet Care Tracker",
    difficulty: "Intermediate",
    category: "Productivity",
    description: "Build a pet care tracker with feeding schedules, vet appointment calendar, medication reminders, photo gallery per pet, and a playful paw-print themed design",
  },
  {
    slug: "podcast-player",
    title: "Podcast Player",
    difficulty: "Intermediate",
    category: "Mobile UIs",
    description: "Build a podcast player with episode list, playback speed controls, chapter markers, queue management, and a minimal audio-focused design",
  },
  {
    slug: "service-booking-app",
    title: "Service Booking App",
    difficulty: "Intermediate",
    category: "Forms & Input",
    description: "Build a service booking app with calendar date picker, time slot selection, service menu, booking confirmation, and a professional clean design",
  },
  {
    slug: "plant-care-app",
    title: "Plant Care App",
    difficulty: "Advanced",
    category: "Productivity",
    description: "Build a plant care app with a plant library, watering schedule reminders, growth photo journal, care tips, and a lush botanical green-themed design add information on specific plants and describe flowers",
  },
];

/** The composer's character limit (PromptInput's MAX_CHARS). */
export const PROMPT_MAX_CHARS = 2000;

/** What picking a template does: fill the prompt with its description. */
export function templatePrompt(t: Pick<StarterTemplate, 'description'>): string {
  return t.description.slice(0, PROMPT_MAX_CHARS);
}
