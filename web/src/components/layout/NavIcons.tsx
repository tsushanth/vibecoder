// The four tab icons, drawn once so the rail and the phone tab bar match. 24px grid, 1.75 stroke, currentColor.
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const AppsIcon = () => (<svg {...base}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></svg>);
export const CreateIcon = () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>);
export const ExploreIcon = () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>);
export const AccountIcon = () => (<svg {...base}><circle cx="12" cy="9" r="3.5" /><path d="M5 19.5c1-3.3 3.8-5 7-5s6 1.7 7 5" /></svg>);
export const SignOutIcon = () => (<svg {...base} width={18} height={18}><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h10" /></svg>);
