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

### Phase 5 — Icônes professionnelles et corrections de fuites de minuteurs
- **Bug corrigé** : `startTorchFlash()`, `startVibrateLoop()` et `startAlarmSoundLoop()` ne s'arrêtaient pas elles-mêmes avant de redémarrer. Si une alarme se redéclenchait pendant qu'une autre était encore active (possible avec un délai entre alarmes à 0 s), un minuteur pouvait rester orphelin — sa référence était écrasée, donc plus rien ne pouvait l'arrêter. C'est ce qui causait la lampe torche qui continuait de flasher après SNOOZE. Les trois fonctions s'arrêtent maintenant toujours elles-mêmes avant de redémarrer (idempotentes).
- **Bug corrigé** : un double appui rapide sur « Démarrer l'écoute » pouvait démarrer une deuxième session micro/reconnaissance en parallèle sans arrêter proprement la première, laissant la barre de son bloquée en mode « actif » même après avoir appuyé sur Arrêter. Un garde-fou empêche maintenant tout double démarrage, et « Arrêter » force systématiquement l'arrêt de tous les minuteurs d'alarme actifs par mesure de sécurité.
- Tous les emojis (⚙️ 📊 🎙️ 🔤 🕘 ⚠ ■) remplacés par des icônes SVG en trait fin (2 px), inline dans le HTML, aucune dépendance externe
- Bouton principal DÉMARRER/ARRÊTER restructuré : icône à gauche du texte, plus large que les autres boutons
- Boutons secondaires (Réglages, Graphiques, Mots, Historique) : fond bleu-gris foncé sobre, bordure fine, sans dégradé ni effet lumineux
- **Aucune logique de reconnaissance vocale, de mots-clés, de stockage ou de service worker n'a été modifiée dans cette phase**, à l'exception des deux corrections de bugs ci-dessus (minuteurs orphelins et double démarrage)

### Phase 6 — Rebranding CB, correction de boucle de rétroaction, sécurisation de l'écran
- **Bug corrigé** : réécouter un enregistrement (historique ou après une alarme) pouvait faire boucler l'alarme indéfiniment — le haut-parleur du téléphone rejouait le mot-clé, le micro le recaptait, ce qui redéclenchait l'alarme. L'écoute s'arrête maintenant automatiquement avant toute réécoute.
- Icônes de l'app (`icon-192.svg`, `icon-512.svg`) : c'étaient en fait des fichiers PNG mal nommés `.svg` — remplacés par de vraies images SVG
- Nouvelle image de marque « CB » (lettres blanches serif, soulignement rouge) — remplace « RADIO TEI » dans le titre, l'en-tête, le manifeste et le splash screen (« by CTR » en dessous)
- Bouton principal Démarrer/Arrêter devenu un simple bouton rond sans texte (micro vert / carré rouge)
- Ajout d'un bouton « haut-parleur » dans le lecteur de l'historique (volume fort par défaut, via le même circuit audio que l'alarme)
- Volume maximal de l'alarme augmenté à nouveau (compresseur resserré, gain de sortie à 3.4)
- Mot-clé « Instrument » passé de « contexte » à « immédiat » par défaut, avec migration automatique des mots déjà enregistrés sur l'appareil
- CSS durci pour éliminer une bande non couverte par le thème sombre en bas de l'écran (zone sécurisée iPhone)

### Phase 7 — Résolution définitive de la bande noire en bas (bug WebKit #254868)

**Symptôme** : une bande noire (~59px) restait visible en bas de l'écran principal, sous la barre de navigation, uniquement quand l'app était installée sur l'écran d'accueil (mode standalone) — jamais dans un onglet Safari normal.

**Cause réelle, confirmée par mesure directe sur l'appareil** : c'est un vrai bug WebKit actif, documenté sous [bugs.webkit.org #254868](https://bugs.webkit.org/show_bug.cgi?id=254868) — « Incorrect height values when viewport-fit=cover is set for installed web apps ». En mode PWA standalone avec `viewport-fit=cover`, iOS fait en sorte que `100dvh`, `100svh`, `visualViewport.height`, `window.innerHeight` et `-webkit-fill-available` **soustraient tous la zone sécurisée du bas** de la valeur retournée — alors que `100vh` (habituellement le moins fiable des trois sur mobile) est, dans ce mode précis, le seul qui retourne la vraie hauteur physique de l'écran.

Confirmé par diagnostic sur l'appareil de Carl (iPhone, écran 852px physique) :
- Avant le correctif : `100dvh` = `100svh` = `window.innerHeight` = **793px** (manque exactement 59px, la zone sécurisée)
- `100vh` = **852px** (correct, dès le début)

**Correctif appliqué** (`style.css`) — bascule vers `100vh` uniquement en mode standalone, comme recommandé dans le fil de discussion du bug WebKit :
```css
@media all and (display-mode: standalone) {
  html, body { height:100vh; min-height:100vh; }
  .app-shell { min-height:100vh; }
}
```
En Safari normal (non installé), le comportement reste inchangé (`100dvh`/`-webkit-fill-available`), qui fonctionne correctement dans ce contexte.

**Ne pas re-« corriger » ceci à l'avenir** : si la bande réapparaît après une mise à jour d'iOS, vérifier d'abord si Apple a corrigé le bug #254868 lui-même (auquel cas `100vh` en standalone redeviendrait inutile ou pourrait nécessiter un ajustement) avant de toucher à autre chose. Le panneau **Réglages → DIAGNOSTIC AFFICHAGE** dans l'app permet de mesurer `100vh`/`100dvh`/`100svh` directement sur l'appareil pour vérifier en 10 secondes si le problème est réapparu.

---

## Limites connues

---

## Points de restauration (commits GitHub)

Chaque phase correspond à un ou plusieurs commits. En cas de problème, l'historique complet est consultable dans l'onglet **Commits** du dépôt — chaque fichier peut être restauré individuellement depuis n'importe quel commit passé.

| Point de restauration | Commit (début) | Description |
|---|---|---|
| Avant Phase 6 (rebranding CB + correctifs) | `513cae21` | Dernier état avec la marque « RADIO TEI » et les icônes PNG mal nommées |
| Avant Phase 5 (icônes SVG + correctifs) | `215a02af` | Dernier état avec emojis, avant le remplacement par les icônes SVG |
| Avant Phase 4 (refonte RADIO TEI) | `6fc7f1fb` | Dernier état de l'ancienne interface « CB Alerte » (cartes empilées, sans barre de navigation) |


- Aucune écoute possible écran verrouillé ou en arrière-plan sur iPhone (limite Apple/WebKit, voir plus haut)
- Vibration inactive sur iPhone
- Les mesures de bruit affichées sont relatives, pas un vrai dB SPL calibré
- Les enregistrements audio de réécoute (20 dernières secondes) sont en mémoire seulement — perdus à la fermeture complète de l'app
