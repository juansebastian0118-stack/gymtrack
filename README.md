# 🏋 GymTrack · Yony Vega & Juan Sebastian

App de seguimiento de clases de entrenamiento con sincronización en tiempo real.

---

## ⚡ PASOS PARA PUBLICAR (15-20 minutos, una sola vez)

### PASO 1 — Crear proyecto en Firebase (base de datos gratuita)

1. Ve a **https://console.firebase.google.com**
2. Clic en **"Agregar proyecto"** → nombre: `gymtrack-yony` → continuar
3. Desactiva Google Analytics (opcional) → **Crear proyecto**
4. Una vez creado, clic en el ícono **`</>`** (Web) para agregar una app web
   - Nombre de app: `gymtrack` → **Registrar app**
   - **Copia los valores** del objeto `firebaseConfig` (los necesitas en el Paso 3)
   - Clic en "Continuar a la consola"
5. En el menú izquierdo → **Firestore Database** → **Crear base de datos**
   - Selecciona **"Modo producción"** → elige la ubicación más cercana (ej: `us-east1`) → Habilitar
6. Una vez creada la base de datos, ve a la pestaña **"Reglas"** y reemplaza el contenido con:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /gymtrack/{docId} {
      allow read, write: if true;
    }
  }
}
```

   Clic en **Publicar**.

---

### PASO 2 — Configurar el código

1. Abre el archivo **`src/firebase.js`**
2. Reemplaza los valores `"PEGA_AQUI_TU_..."` con los datos que copiaste en el Paso 1:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",      // ← tu apiKey real
  authDomain:        "gymtrack-yony.firebaseapp.com",
  projectId:         "gymtrack-yony",
  storageBucket:     "gymtrack-yony.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123",
};
```

---

### PASO 3 — Instalar dependencias y probar localmente

Asegúrate de tener **Node.js 18+** instalado (https://nodejs.org).

```bash
# En la carpeta del proyecto:
npm install
npm run dev
```

Abre http://localhost:5173 — deberías ver la app funcionando.

---

### PASO 4 — Publicar en Vercel (link compartible gratuito)

**Opción A — Desde el navegador (más fácil):**

1. Ve a **https://vercel.com** → Regístrate con tu cuenta de GitHub/Google
2. Clic en **"Add New Project"**
3. Sube la carpeta del proyecto:
   - Primero crea un repositorio en https://github.com/new
   - En la carpeta del proyecto ejecuta:
     ```bash
     git init
     git add .
     git commit -m "gymtrack inicial"
     git remote add origin https://github.com/TU_USUARIO/gymtrack.git
     git push -u origin main
     ```
   - En Vercel, importa ese repositorio
4. Vercel detecta automáticamente que es Vite → clic en **Deploy**
5. En ~2 minutos tendrás tu link: `https://gymtrack-yony.vercel.app` ✅

**Opción B — Desde terminal (más rápido si ya tienes Vercel CLI):**

```bash
npm install -g vercel
vercel --prod
```

---

## 🔗 Compartir con el profesor

Una vez desplegado, el link generado por Vercel es permanente y funciona en cualquier dispositivo.

- **Tú** abres el link → haces cambios → se guardan automáticamente en Firebase
- **Yony Vega** abre el mismo link → ve los cambios en tiempo real (se actualiza solo)
- Ambos pueden marcar clases, cambiar horarios, etc.
- Cualquier cambio de cualquiera de los dos queda guardado inmediatamente

---

## 📁 Estructura del proyecto

```
gymtrack/
├── src/
│   ├── App.jsx          ← Toda la lógica y UI de la app
│   ├── firebase.js      ← Configuración Firebase (editar con tus keys)
│   ├── main.jsx         ← Punto de entrada React
│   └── index.css        ← Estilos globales
├── public/
│   └── favicon.svg
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

---

## 🆓 Costos

- **Firebase Firestore** (plan Spark gratuito): 50.000 lecturas/día, 20.000 escrituras/día → más que suficiente para 2 usuarios
- **Vercel** (plan hobby gratuito): hosting ilimitado para proyectos personales

**Total: $0 / mes**
