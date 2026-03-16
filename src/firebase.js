// ─────────────────────────────────────────────────────────────────────────────
//  INSTRUCCIONES:
//  1. Ve a https://console.firebase.google.com
//  2. Crea un proyecto (ej: "gymtrack-yony")
//  3. Agrega una app Web → copia la configuración aquí abajo
//  4. En Firestore Database → Crear base de datos → Modo producción
//  5. En Reglas de Firestore, pega esto y guarda:
//
//     rules_version = '2';
//     service cloud.firestore {
//       match /databases/{database}/documents {
//         match /gymtrack/{docId} {
//           allow read, write: if true;
//         }
//       }
//     }
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCwnhjxwaEXDpDteu2vM4J7q9kD2iUmr3Y",
  authDomain: "gymtrack-yony-juan.firebaseapp.com",
  projectId: "gymtrack-yony-juan",
  storageBucket: "gymtrack-yony-juan.firebasestorage.app",
  messagingSenderId: "859699865549",
  appId: "1:859699865549:web:3dc756c0e26f6f5f5c8684"
}
;

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
