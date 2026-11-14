# smsmode pour Gladys Assistant

**Non officiel**, sans lien avec smsmode. Jamais testé avec un vrai compte smsmode : le format de l'API
vient de sa documentation publique (lue le 14 novembre 2026).

Cette intégration envoie des SMS depuis vos scènes Gladys, par votre propre compte
[smsmode](https://www.smsmode.com/) (opérateur français d'envoi de SMS). Chaque SMS est payé sur votre
crédit smsmode.

- **Envoi seul** : rien n'est reçu, aucune réponse SMS n'est lue.
- Un SMS ne part que d'une **action de scène** « Envoyer un SMS (smsmode) » ou d'un clic sur le bouton
  « Envoyer un SMS de test ». Aucun SMS au démarrage, à la reconnexion ni quand vous enregistrez la
  configuration.
- Pour la France : mobiles français (06, 07, outre-mer compris). Un numéro étranger écrit avec + ou 00
  est accepté aussi, au tarif smsmode de son pays.

## Avant de commencer

1. Créez un compte sur [smsmode.com](https://www.smsmode.com/) et achetez du crédit.
2. Dans votre espace client smsmode, rubrique API, créez une **clé d'API**.
3. Dans Gladys, installez l'intégration, collez la clé, enregistrez.
4. Cliquez sur **Vérifier la clé et le crédit** : smsmode dit s'il accepte la clé et donne le solde du
   compte. Ce bouton n'envoie aucun SMS.
5. Si vous voulez, cliquez sur **Envoyer un SMS de test** avec votre numéro (un SMS payant, compté dans
   le plafond horaire).

## Configuration

| Réglage                           | Rôle                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clé d'API smsmode                 | Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement à smsmode (en-tête `X-Api-Key` de `https://rest.smsmode.com`).                                                      |
| Numéros par défaut                | Utilisés quand l'action de scène n'en donne pas. Séparés par des virgules, 5 au plus.                                                                                                    |
| Nom de l'émetteur                 | Facultatif : 3 à 11 lettres ou chiffres, dont une lettre au moins (« MaMaison »). Vide : l'émetteur par défaut de smsmode. Un émetteur invalide bloque l'envoi (le statut le dit).       |
| Ajouter la mention STOP           | smsmode ajoute « STOP » et un numéro court à la fin du SMS. smsmode la demande pour un émetteur personnalisé sur un canal marketing ; sans elle, un opérateur peut remplacer l'émetteur. |
| Nombre maximal de SMS par heure   | Plafond de sécurité, de 1 à 200 (20 par défaut). Voir plus bas.                                                                                                                          |
| Nombre maximal de SMS par message | De 1 à 10 (3 par défaut) : au-delà, le texte est coupé et finit par « ... ».                                                                                                             |
| Accents                           | « Les garder » (par défaut) ou « Simplifier » (voir plus bas).                                                                                                                           |

### Numéros acceptés

- Mobiles français : `06 12 34 56 78`, `07.12.34.56.78`, `+33 6 12 34 56 78`, `0033 6...`, `33612345678`.
- Mobiles d'outre-mer écrits à la française : 0692 et 0693 (La Réunion), 0639 (Mayotte), 0690 et 0691
  (Guadeloupe, Saint-Martin, Saint-Barthélemy), 0694 (Guyane), 0696 et 0697 (Martinique) : l'indicatif
  du territoire est mis à leur place.
- Tout numéro international écrit avec `+` ou `00` (8 à 15 chiffres).
- Refusés : les fixes et numéros spéciaux français (01 à 05, 08, 09 : ils ne reçoivent pas de SMS), les
  numéros courts, les lettres.

Un numéro n'est jamais écrit en entier dans les journaux ni dans les messages : seuls les 3 premiers et
les 2 derniers chiffres apparaissent (`336******78`).

## L'action de scène « Envoyer un SMS (smsmode) »

Champs :

- **Texte** (obligatoire) : les variables de scène y sont remplacées par Gladys.
- **Numéros** (facultatif) : vide, les numéros par défaut.

Résultats, utilisables par les actions suivantes de la scène :

- `sent` : nombre de SMS acceptés par smsmode ;
- `not_sent` : destinataires non atteints (refusés, non tentés, ou sans confirmation) ;
- `message_ids` : identifiants smsmode des messages acceptés, séparés par des virgules ;
- `truncated` : vrai si le texte a été coupé.

Si aucun SMS n'est accepté, l'action échoue avec la raison dans le journal de la scène (« Rien envoyé :
le plafond horaire est atteint », …) ; la scène continue. Plusieurs destinataires sont servis l'un après
l'autre : un 400 sur un numéro n'empêche pas le suivant ; un refus de la clé, un crédit insuffisant, une
panne ou un délai dépassé arrêtent les suivants.

L'action donne une minute au plus à Gladys. Une requête dure 10 secondes au plus ; un destinataire qui
n'a plus 10 secondes devant lui n'est pas tenté.

## Les garde-fous

- **Plafond horaire** : les SMS facturés sur les 60 dernières minutes (un texte de 2 SMS compte 2, et
  chaque destinataire compte) ne dépassent jamais le réglage. Un SMS est compté avant que sa requête
  parte ; il est rendu seulement si smsmode ne l'a sûrement pas pris (erreur 4xx, serveur introuvable,
  connexion refusée). Le nombre de morceaux est celui que calcule le module, relevé si smsmode en
  annonce plus dans sa réponse. Les heures d'envoi sont gardées dans `/data` : un redémarrage ne remet
  pas le compteur à zéro. Si `/data` est illisible (le statut le dit) ou ne peut pas être écrit, le
  plafond ne compte que les SMS envoyés depuis le démarrage ; l'envoi n'est pas bloqué pour autant.
- **Jamais de nouvel essai** d'un SMS qui a pu partir (délai dépassé, connexion coupée, erreur 5xx) :
  un second essai pourrait être un second SMS payant. Le résultat dit « envoyé sans confirmation ».
- **Un seul envoi à la fois** vers smsmode ; 20 envois au plus attendent leur tour, au-delà ils sont
  refusés.
- **Pause** : après un 429 (smsmode demande de ralentir), la durée indiquée par smsmode, entre 60 s et
  6 h ; après une erreur 5xx, 60 s, doublée à chaque nouvelle erreur, 6 h au plus. Rien n'est envoyé
  pendant la pause, boutons compris ; elle est gardée dans `/data`.
- **Clé refusée** (401) : plus aucune scène ne l'utilise. Une empreinte courte (8 bits, salée) est
  gardée dans `/data`, jamais la clé. Le refus est levé par une nouvelle clé, ou par un succès de l'un des
  deux boutons (qui, eux, essaient la clé).
- **Crédit insuffisant** (402) ou **émetteur refusé** (403) : le statut le dit ; l'envoi suivant est
  quand même tenté (smsmode décide).

## Texte, accents et coût

Un SMS compte 160 caractères de l'alphabet SMS (GSM 7 bits), ou 153 par morceau au-delà. Cet alphabet
contient é, è, à, ù, ì, ò, Ç mais **pas** ê, â, î, ô, û, ë, ï, ç, œ, ’, « », ni les emojis : un seul de ces
caractères fait passer tout le texte en Unicode, 70 caractères par SMS (67 par morceau). Les
caractères € [ ] { } ^ ~ | \ comptent double.

« Simplifier » remplace ê par e, ç par c, œ par oe, ’ par ', « » par ", – par -, … par ..., l'espace
insécable par une espace : un texte français reste à 160 caractères par SMS. Un emoji reste tel quel.

Les caractères de contrôle et invisibles sont retirés, les retours à la ligne gardés.

## Statut

Le statut de l'intégration dit : prête (avec le plafond), clé manquante ou refusée, émetteur invalide,
pause en cours et son heure de fin (heure de Paris), crédit insuffisant au dernier envoi, configuration
pas encore lue (nouvel essai à 5 s, 10 s, 30 s, 1 min puis toutes les 5 min), numéros par défaut
illisibles, `/data` illisible.

## Données

- Envoyé à smsmode : la clé (en-tête), le numéro, le texte, l'émetteur et la mention STOP s'ils sont
  réglés.
- Gardé dans `/data/smsmode-state.json` : l'heure et le nombre de morceaux des SMS de la dernière heure,
  la pause en cours, le sel et l'empreinte de 8 bits d'une clé refusée. Ni clé, ni numéro, ni texte.
- Journaux : numéros masqués, nombre de SMS par message jamais le texte, jamais la clé.

## Limites

- Ce n'est pas un canal de messagerie de Gladys : l'action « Envoyer un message » de Gladys ne passe pas
  par smsmode. C'est voulu : un canal recevrait aussi les messages système de Gladys (sauvegarde,
  piles…), autant de SMS payants envoyés sans action de scène.
- Les accusés de réception (livré, non livré) ne sont pas suivis : « accepté » veut dire que smsmode a
  pris le SMS, pas qu'il est arrivé.
- La vérification du crédit lit la première organisation de la clé ; une clé au rôle restreint peut ne
  pas y avoir droit (le bouton dit alors seulement que la clé est acceptée).
