# Animate UI sources

Official list icon and required icon wrapper, slot and visibility hook:
https://github.com/imskyleen/animate-ui/tree/main/apps/www/registry

Retrieved 2026-09-20, MIT license. The list animation is unchanged.
Local integration changes: resolve imports to this project; remove the unused React import from list.tsx (automatic JSX runtime). Restore the official icon wrapper's asChild API after shadcn's Base UI transformation incorrectly converted it to render props.
The workbench animated-list-icon.tsx only adapts the controlled trigger to the existing button interaction adapter.
