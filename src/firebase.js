import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyD9GxAhROp-3GyTmWU3pJBQ4sHKf28aN4s',
  authDomain: 'stashpro-660.firebaseapp.com',
  projectId: 'stashpro-660',
  storageBucket: 'stashpro-660.firebasestorage.app',
  messagingSenderId: '565013718837',
  appId: '1:565013718837:web:41adee82f7647528320e7c'
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
