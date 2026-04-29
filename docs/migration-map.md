# Template to React Migration Map

## Source Pages to React Routes
- `index.html` -> `/` (`HomePage`)
- `about.html` -> `/about` (`AboutPage`)
- `service.html` -> `/services` (`ServicesPage`)
- `why.html` -> `/why-us` (`WhyUsPage`)
- `team.html` -> `/team` (`TeamPage`)

## New Product Mock Routes
- `/plans` (`PlansPage`)
- `/calculator` (`CalculatorPage`)
- `/dashboard` (`DashboardPage`)

## Shared Layout Components
- `Header` (navigation + language switcher)
- `Footer` (contacts, links, newsletter, copyright year)
- `PageHero` (sub-page top banner)
- `SectionHeading` (title with highlighted span)

## Section Components (from template blocks)
- `HeroSection`
- `ServicesSection`
- `AboutSection`
- `WhyChooseSection`
- `TeamSection`
- `TestimonialsSection`
- `InfoSection`

## JS Behavior to Replace
- `#displayYear` auto year from `js/custom.js` -> `new Date().getFullYear()` inside `Footer`.
- `owlCarousel` testimonials slider -> React carousel behavior (state-driven slide navigation).
- Bootstrap navbar collapse JS -> React state toggle for mobile navigation.

## Asset Strategy
- Reuse existing assets from `images/` and static styles from `css/style.css` + `css/responsive.css`.
- Drop jQuery dependency; keep CSS only.
