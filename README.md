# RADIO TEI (anciennement CB Alerte)

Application web progressive (PWA) qui écoute un haut-parleur de radio CB via le microphone du téléphone, détecte des mots-clés parlés (comme un nom ou un code d'appel), et déclenche une alarme visuelle/sonore pour ne jamais manquer un appel de service.

**Site en ligne :** https://carltherock.github.io/cb-instrumentation/

---

## Qu'est-ce qu'une PWA ?

Une PWA (Progressive Web App) est un site web qui se comporte comme une application native :
- S'installe sur l'écran d'accueil de l'iPhone (« Ajouter à l'écran d'accueil » dans Safari)
- S'ouvre en plein écran, sans barre d'adresse, comme une vraie app
- Fonctionne hors-ligne grâce à un « service worker » (`sw.js`) qui garde une copie locale des fichiers
- Aucun passage par l'App Store — mise à jour instantanée dès qu'on modifie les fichiers sur GitHub Pages

**Limites importantes sur iPhone** (imposées par Apple, pas par le code de l'app) :
- L'écoute du micro et la reconnaissance vocale s'arrêtent dès que le téléphone se verrouille ou qu'on change d'app
- La vibration (`navigator.vibrate`) n'est pas supportée par Safari sur iPhone
- Une app ne peut jamais se ramener elle-même au premier plan pendant qu'on utilise une autre app — c'est une règle de sécurité d'iOS

---

## Comment ça marche

1. Le téléphone est placé près du haut-parleur du CB
2. L'app utilise `SpeechRecognition` (reconnaissance vocale intégrée au navigateur) pour transcrire ce qui est dit
3. Le texte transcrit est comparé à une liste de mots-clés (avec variantes orthographiques pour compenser les erreurs de reconnaissance)
4. Si un mot « immédiat » est reconnu (ex. TEI, Desrochers), l'alarme se déclenche tout de suite
5. Si un mot « contexte » est reconnu (ex. Technicien, Instrument), il faut deux mots différents de ce type dans une fenêtre de 8 secondes
6. L'alarme prend l'écran en plein écran, clignote rouge/blanc, joue un son (choix parmi plusieurs sirènes), fait vibrer (Android seulement) et fait clignoter la lampe torche
7. Un enregistrement audio des 20 dernières secondes est gardé en mémoire pour pouvoir réécouter ce qui a été dit

Tout est stocké localement sur l'appareil (`localStorage`) : mots-clés, réglages, historique des alertes. Rien n'est envoyé à un serveur.

---

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Apparence visuelle (thème sombre industriel bleu/noir) |
| `app.js` | Toute la logique : reconnaissance vocale, détection, alarme, historique |
| `manifest.webmanifest` | Nom, icônes et couleurs de l'app installée |
| `sw.js` | Service worker — gère le cache hors-ligne. **La version du cache doit être augmentée (`CACHE = 'cb-alerte-vX'`) à chaque changement important**, sinon le téléphone continue de servir une vieille version. |

---

## Historique des versions (phases)

### Phase 1 — Base fonctionnelle (CB Alerte)
- Écoute continue du micro, reconnaissance vocale en français canadien
- Détection de mots-clés (immédiats et contextuels), avec variantes
- Alarme plein écran clignotante avec son
- Historique des alertes et liste de mots-clés modifiable, sauvegardés en local

### Phase 2 — Fiabilité et son
- Correction d'un bug de cache du service worker qui empêchait les mises à jour d'atteindre le téléphone (`sw.js` passé en stratégie « réseau d'abord »)
- Bouton « TESTER L'ALARME » corrigé (création fiable du contexte audio sur iOS)
- Volume de l'alarme augmenté (compresseur audio + gain de sortie)
- Ajout de plusieurs sons d'alarme (police, ambulance, pompier, klaxon, sonnerie, cloche, corne de brume, détecteur de fumée, buzzer, sirène longue, rejouer l'appel)
- Bouton SNOOZE qui rejoue les 20 dernières secondes captées, avec lecteur audio et barre de progression déplaçable
- Lampe torche qui clignote pendant l'alarme, avec permission caméra demandée une seule fois (au démarrage de l'écoute, pas à chaque alarme)

### Phase 3 — Sensibilité et calibration du bruit ambiant
- Réglage de sensibilité du détecteur de son et mode « détection rapide » (mots-clés détectés avant la fin de la phrase)
- Bouton de mesure du bruit ambiant, avec calibration automatique par médiane glissante (s'ajuste lentement pour ignorer les pics ponctuels comme la voix)
- Filtre audio qui isole la bande de fréquences de la voix humaine (300–3400 Hz) pour que l'indicateur de son ignore le bruit de moteur/machinerie
- Graphiques (niveau, spectre de fréquences, stabilisation de la calibration), cliquables en plein écran avec curseur déplaçable et écart-type (σ) affiché

### Phase 4 — Refonte visuelle « RADIO TEI »
- Nouvelle image de marque : RADIO TEI, dégradé bronze
- Interface réorganisée : barre de navigation fixe en bas (Réglages / Graphiques / Démarrer-Arrêter / Mots / Historique), chaque section devient une fenêtre modale
- Zones sécurisées iPhone (encoche, barre du bas) via `env(safe-area-inset-*)` et `100dvh`
- Nouvelles statistiques dans Graphiques : alertes du jour, transmissions reconnues du jour, alertes par heure
- Confirmation ajoutée avant d'effacer l'historique
- Section « Avant de partir » retirée
- **Aucune logique de détection, d'alarme ou de stockage n'a été modifiée dans cette phase — seulement l'interface.**

---

## Limites connues

- Aucune écoute possible écran verrouillé ou en arrière-plan sur iPhone (limite Apple/WebKit, voir plus haut)
- Vibration inactive sur iPhone
- Les mesures de bruit affichées sont relatives, pas un vrai dB SPL calibré
- Les enregistrements audio de réécoute (20 dernières secondes) sont en mémoire seulement — perdus à la fermeture complète de l'app
