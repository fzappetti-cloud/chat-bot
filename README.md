# GymFlow AI (Fito) – demo de chatbot

Chat comercial para gimnasios. El navegador habla con `/api/chat` y el servidor
(`server.js`) reenvía a Groq con la clave guardada como variable de entorno.

## Estructura
```
server.js        servidor + proxy seguro a Groq
package.json
public/          index.html + imágenes (gymflow_logo.png, gym_backdrop.jpg, gym1.jpg ... )
.env.example     modelo de variables (el .env real NO se sube)
```

## Correr en tu PC
Requiere Node 18 o superior.

PowerShell (Windows):
```
$env:GROQ_API_KEY="tu_clave_nueva"; node server.js
```
Mac / Linux:
```
GROQ_API_KEY=tu_clave_nueva node server.js
```
Abrí http://localhost:3999

## Publicar en Railway
1. Subí este proyecto a GitHub (sin ninguna clave adentro).
2. En Railway: New Project → Deploy from GitHub repo → elegí `chat-bot`.
3. En la pestaña Variables agregá `GROQ_API_KEY` con la clave nueva.
4. En Settings → Networking → Generate Domain para obtener el link público.

## Imágenes que usa el bot (van dentro de `public/`)
gymflow_logo, gym_backdrop, arquitectura_multitenant, secuencia_whatsapp_retencion,
rutinas_seguimiento, clases_grupales, registro_pagos_automatizado, contabilidad_predictiva.
(El servidor acepta .jpg, .jpeg, .png o .webp indistintamente.)
