# SmartLearnWeb - README

## Resumen
SmartLearnWeb es el frontend de SmartLearn.
Consume la API del backend para login, panel de usuario, examenes, cursos, salas y soporte.

## Framework y stack usado
- Framework principal: Next.js 16.1.6
- Runtime frontend: Node.js
- UI library: React 19.2.3
- Lenguaje: TypeScript 5
- Estilos: Tailwind CSS 4
- Linter: ESLint 9 + eslint-config-next
- Render: App Router (carpeta `src/app`)

## Dependencias principales (package.json)
- next
- react
- react-dom
- typescript
- tailwindcss
- @tailwindcss/postcss
- eslint
- eslint-config-next

## Estructura base
- `src/app/page.tsx` -> login
- `src/app/dashboard/page.tsx` -> panel principal
- `src/app/dashboard/examenes` -> modulo examenes
- `public` -> imagenes y assets estaticos
- `next.config.ts` -> config de Next y rutas

## Comandos utiles
- Desarrollo: `npm run dev`
- Build: `npm run build`
- Produccion: `npm run start`
- Revision codigo: `npm run lint`
- Tipado: `npx tsc --noEmit`

## Runtime recomendado
- Node.js 20+
- npm 10+

## Variables de entorno comunes
- `NEXT_PUBLIC_API_BASE_URL` -> URL publica de API para el cliente
- `API_INTERNAL_URL` -> URL interna usada por el servidor Next
