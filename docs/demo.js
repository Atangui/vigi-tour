/* ==========================================================================
   Vigie Tour — mode démo
   Simule l'API locale (/api/...) dans le navigateur, avec des données 100 % fictives
   (agence événementielle « Nova Events »). L'interface tourne ainsi sans serveur Python,
   par exemple sur GitHub Pages. Rien n'est envoyé nulle part, rien n'est enregistré :
   un rechargement de la page remet la démo à zéro.
   ========================================================================== */
(function () {
  "use strict";

  const REPO_URL = "";   // ex. "https://github.com/<compte>/vigie-tour" : ajoute un lien « Code source » au badge

  /* ===================== Utilitaires ===================== */
  const HOUR = 36e5;
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };          // AAAA-MM-JJ, aujourd'hui + n
  const wd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("fr-FR", { weekday: "long" }); };
  const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
  const nowLocal = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hms = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const plural = (n, a, b) => (n > 1 ? b : a);
  const longDay = (iso) => new Date(iso + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ===================== Personnages fictifs ===================== */
  const P = {
    me:       { name: "Charles Atangui",        email: "charles@example.com" },
    lea:      { name: "Léa Martin",         email: "lea.martin@example.com",        tu: true },
    hugo:     { name: "Hugo Bernard",       email: "hugo.bernard@example.com",      tu: true },
    sarah:    { name: "Sarah Cohen",        email: "sarah.cohen@example.com",       tu: true },
    yanis:    { name: "Yanis Petit",        email: "yanis.petit@example.com",       tu: true },
    ines:     { name: "Inès Moreau",        email: "ines.moreau@example.com",       tu: true },
    nora:     { name: "Nora Benali",        email: "nora.benali@example.com",       tu: true },
    camille:  { name: "Camille Roux",       email: "camille.roux@example.com" },
    marc:     { name: "Marc Dubois",        email: "marc.dubois@alto-sports.example.com" },
    julien:   { name: "Julien Garnier",     email: "j.garnier@mediaflux.example.com" },
    hostline: { name: "Hostline Support",   email: "support@hostline.example.com",  org: true },
    hostmon:  { name: "Hostline Monitoring", email: "no-reply@hostline.example.com", org: true },
    wf:       { name: "Wordfence",          email: "alerts@wordfence.example.com",  org: true },
    wpm:      { name: "WP Monitor",         email: "alerts@wp-monitor.example.com", org: true },
  };

  /* ===================== Données : fils de mails et tâches ===================== */
  const MSGS = {};     // thread_key → messages
  const FOLDER = {};   // thread_key → dossier Outlook du dernier mail reçu
  const TASKS = [];
  let nextId = 1;

  // m = [sens, personnage, il y a N heures, objet, corps, pièce jointe ?]
  function thread(key, folder, list) {
    FOLDER[key] = folder;
    MSGS[key] = list.map(([dir, who, h, subject, body, att], i) => {
      const p = P[who], out = dir === "out";
      return {
        msg_id: `<${key.replace(/\W+/g, "-")}-${i}@demo.example.com>`, direction: dir,
        from_name: out ? P.me.name : p.name, from_addr: out ? P.me.email : p.email,
        to_addrs: out ? p.email : P.me.email, cc_addrs: "", subject, date_utc: ago(h), body,
        has_attachments: att ? 1 : 0, folder, web_link: null, is_form: 0, can_open: 0,
      };
    }).sort((a, b) => (a.date_utc < b.date_utc ? -1 : 1));
  }

  function task(o) {
    const ms = MSGS[o.key], last = ms[ms.length - 1];
    const t = {
      id: nextId++, thread_key: o.key, kind: o.kind, title: o.title, summary: o.summary || "",
      deadline: o.dl === undefined || o.dl === null ? null : day(o.dl), deadline_type: o.dl === undefined || o.dl === null ? "aucune" : (o.dlt || "estimee"),
      priority: o.prio || "moyenne", delegate_to: o.deleg ? o.deleg[0] : null, delegate_reason: o.deleg ? o.deleg[1] : null,
      steps: o.steps || [], draft_reply: o.draft || null, evidence: o.ev || "", confidence: o.conf ?? 0.7,
      status: o.status || (o.kind === "en_attente" ? "en_attente" : "a_faire"),
      snooze_until: o.snooze || null, notes: o.notes || "", user_edited: o.status === "fait" || o.status === "ignore" ? 1 : 0,
      source_msg_id: last.msg_id, created_at: o.created != null ? ago(o.created) : last.date_utc,
      updated_at: o.updated != null ? ago(o.updated) : last.date_utc, lot: o.lot || null, reviewed: o.reviewed ? 1 : 0, source: o.src || "ia",
      _who: o.who,
    };
    TASKS.push(t);
    return t;
  }

  const SIGN_TU = "Bonne journée,\nCharles", SIGN_VOUS = "Bien cordialement,\nCharles Atangui";

  /* ---------- En retard ---------- */
  thread("s:page programme", "Projets / Nova Summit", [
    ["in", "lea", 70, "Page Programme — créneaux journée 2",
      `Bonjour Charles,\n\nLe programme de la journée 2 est validé côté contenu. Peux-tu mettre à jour la page Programme du site avec les nouveaux créneaux (tableau en pièce jointe) ?\n\nIl faudrait que ce soit en ligne avant la prochaine newsletter.\n\nMerci !\nLéa`, true],
    ["out", "lea", 66, "RE: Page Programme — créneaux journée 2",
      `Hello Léa,\n\nBien reçu, je regarde ça dès que j’ai fini le correctif du formulaire d’inscription. Je te confirme l’heure de mise en ligne.\n\nCharles`],
    ["in", "lea", 20, "RE: Page Programme — créneaux journée 2",
      `Merci Charles. Petit ajout : la table ronde de 16 h 30 passe en salle B. Tu peux l’intégrer aussi ? C’est urgent, la newsletter part bientôt.\n\nLéa`],
  ]);
  task({ key: "s:page programme", kind: "a_faire", prio: "haute", dl: -1, dlt: "explicite", who: "lea", src: "ia", conf: 0.88, created: 20,
    title: "Mettre à jour la page Programme (créneaux journée 2, table ronde en salle B)",
    summary: "Léa demande d’intégrer les créneaux de la journée 2, puis la table ronde de 16 h 30 déplacée en salle B, avant la prochaine newsletter.",
    ev: "Peux-tu mettre à jour la page Programme du site avec les nouveaux créneaux",
    steps: ["Relire le tableau des créneaux en pièce jointe", "Mettre à jour la page Programme et la table ronde de 16 h 30 (salle B)", "Vérifier l’affichage sur mobile", "Prévenir Léa que c’est en ligne"],
    draft: `Bonjour Léa,\n\nC’est noté : j’intègre les créneaux de la journée 2 et la table ronde de 16 h 30 en salle B. Je te préviens dès que c’est en ligne.\n\n${SIGN_TU}` });

  thread("s:formulaire d'inscription en erreur", "Boîte de réception", [
    ["in", "sarah", 30, "Formulaire d’inscription en erreur",
      `Salut Charles,\n\nUn participant vient de m’écrire : le formulaire d’inscription au Nova Summit renvoie une erreur 500 à la validation. Tu peux regarder rapidement ? On risque de perdre des inscriptions.\n\nSarah`],
  ]);
  task({ key: "s:formulaire d'inscription en erreur", kind: "a_faire", prio: "haute", dl: 0, dlt: "estimee", who: "sarah", src: "ia", conf: 0.91,
    title: "Corriger l’erreur 500 du formulaire d’inscription",
    summary: "Un participant n’arrive pas à valider son inscription : le formulaire renvoie une erreur 500.",
    ev: "le formulaire d’inscription au Nova Summit renvoie une erreur 500 à la validation",
    steps: ["Reproduire l’erreur depuis la page d’inscription", "Consulter le journal d’erreurs PHP du site", "Corriger ou désactiver l’extension fautive", "Tester une inscription complète puis répondre à Sarah"],
    draft: `Salut Sarah,\n\nJe regarde ça tout de suite et je te dis où on en est d’ici une heure.\n\n${SIGN_TU}` });

  thread("t:ticket #4821", "Support / Hostline", [
    ["in", "hostline", 120, "[Hostline] Ticket #4821 — Migration PHP 8.3 du site principal (Waiting for reply: Customer)",
      `Bonjour,\n\nNous avons planifié la migration de votre hébergement vers PHP 8.3. Pour valider la compatibilité, merci de nous confirmer que votre thème et vos extensions ont été testés sur l’environnement de préproduction.\n\nCordialement,\nSupport Hostline`],
    ["out", "hostline", 100, "RE: [Hostline] Ticket #4821 — Migration PHP 8.3 du site principal (Waiting for reply: Provider)",
      `Bonjour,\n\nNous testons ce week-end. Pouvez-vous nous laisser l’accès à la préproduction jusqu’à lundi ?\n\nCordialement,\nCharles Atangui`],
    ["in", "hostline", 52, "[Hostline] Ticket #4821 — Migration PHP 8.3 du site principal (Waiting for reply: Customer)",
      `Bonjour,\n\nL’accès à la préproduction est prolongé jusqu’à ce soir. Merci de nous confirmer le résultat de vos tests afin que nous fixions la date de bascule.\n\nCordialement,\nSupport Hostline`],
  ]);
  task({ key: "t:ticket #4821", kind: "a_faire", prio: "moyenne", dl: -2, dlt: "estimee", who: "hostline", src: "local", conf: 0.7,
    title: "Ticket 4821 — Répondre à Hostline : résultat des tests PHP 8.3",
    summary: "Hostline attend notre confirmation des tests sur la préproduction pour fixer la date de bascule vers PHP 8.3.",
    ev: "Merci de nous confirmer le résultat de vos tests afin que nous fixions la date de bascule",
    steps: ["Relire la demande", "Faire le nécessaire", "Répondre à Hostline pour confirmer"],
    draft: `Bonjour,\n\nMerci pour votre message, je m’en occupe et je vous reviens rapidement.\n\n${SIGN_VOUS}` });

  thread("s:infos pratiques", "Projets / Nova Summit", [
    ["in", "lea", 80, "Page Infos pratiques",
      `Charles, on a besoin de la page Infos pratiques (accès, hôtels, parking) avant la fin de la semaine. Tu peux la préparer ?\n\nLéa`],
    ["out", "lea", 52, "RE: Page Infos pratiques",
      `Hello Léa,\n\nOui, je la publie demain matin et je t’envoie le lien pour relecture.\n\nCharles`],
  ]);
  task({ key: "s:infos pratiques", kind: "engagement", prio: "moyenne", dl: -1, dlt: "explicite", who: "lea", src: "ia", conf: 0.78,
    title: "Publier la page Infos pratiques et envoyer le lien à Léa",
    summary: "J’ai promis à Léa de publier la page Infos pratiques « demain matin » et de lui envoyer le lien pour relecture.",
    ev: "je la publie demain matin et je t’envoie le lien pour relecture",
    steps: ["Faire ce que j’ai promis : « je la publie demain matin »", "Envoyer le lien à Léa"],
    draft: `Hello Léa,\n\nComme promis, voici le lien de la page Infos pratiques : …\n\n${SIGN_TU}` });

  thread("s:accès à l'outil d'e-mailing", "Boîte de réception", [
    ["out", "ines", 110, "Accès à l’outil d’e-mailing",
      `Salut Inès,\n\nPeux-tu me donner un accès à l’outil d’e-mailing pour créer la liste « Exposants 2027 » ? J’en ai besoin pour préparer le prochain envoi.\n\nMerci,\nCharles`],
  ]);
  task({ key: "s:accès à l'outil d'e-mailing", kind: "en_attente", prio: "moyenne", dl: -1, dlt: "estimee", who: "ines", src: "local", conf: 0.6,
    title: "Relancer Inès si pas de réponse : accès à l’outil d’e-mailing",
    summary: "J’ai demandé à Inès un accès à l’outil d’e-mailing pour créer la liste « Exposants 2027 ».",
    ev: "Peux-tu me donner un accès à l’outil d’e-mailing pour créer la liste « Exposants 2027 » ?",
    steps: ["Attendre la réponse d’Inès", "Relancer Inès si rien n’est arrivé"],
    draft: `Bonjour Inès,\n\nJe me permets de revenir vers toi au sujet de mon précédent message : as-tu pu avancer ?\n\nMerci,\nCharles` });

  /* ---------- Aujourd'hui ---------- */
  thread("s:newsletter dernières places", "Newsletters", [
    ["in", "ines", 26, "Newsletter « Dernières places » — planning d’envoi",
      `Hello Charles,\n\nLa newsletter « Dernières places » est prête dans l’outil. Peux-tu la programmer pour ${wd(1)} 9 h et vérifier les liens UTM avant ? Il faut aussi exclure les inscrits de la liste VIP.\n\nMerci !\nInès`],
  ]);
  task({ key: "s:newsletter dernières places", kind: "a_faire", prio: "haute", dl: 0, dlt: "explicite", who: "ines", src: "ia", conf: 0.9,
    title: `Programmer la newsletter « Dernières places » (${wd(1)} 9 h)`,
    summary: "Inès demande de programmer l’envoi, de vérifier les liens UTM et d’exclure la liste VIP.",
    ev: "Peux-tu la programmer pour " + wd(1) + " 9 h et vérifier les liens UTM avant ?",
    steps: ["Vérifier les liens UTM de la newsletter", "Exclure la liste VIP de l’envoi", `Programmer l’envoi ${wd(1)} à 9 h`, "Envoyer un test à Inès"],
    draft: `Hello Inès,\n\nC’est noté : je vérifie les liens UTM, j’exclus la liste VIP et je programme l’envoi pour ${wd(1)} 9 h. Je t’envoie un test avant.\n\n${SIGN_TU}` });

  thread("s:bio camille roux", "Projets / Nova Summit", [
    ["in", "sarah", 50, "Bio de Camille Roux (keynote) pour la page Intervenants",
      `Salut Charles,\n\nVoici la bio de Camille Roux pour la page Intervenants :\n\n« Camille Roux dirige la recherche UX chez Orbis Labs. Elle intervient depuis dix ans sur l’accessibilité des événements hybrides. »\n\nTu peux la mettre en ligne dès aujourd’hui ? Camille la relit ce soir. Sa photo arrivera directement de sa part.\n\nSarah`],
  ]);
  task({ key: "s:bio camille roux", kind: "a_faire", prio: "moyenne", dl: 0, dlt: "explicite", who: "sarah", src: "ia", conf: 0.84,
    title: "Mettre en ligne la bio de Camille Roux (page Intervenants)",
    summary: "Sarah envoie la bio de la keynote à publier aujourd’hui ; Camille la relit ce soir.",
    ev: "Tu peux la mettre en ligne dès aujourd’hui ?",
    steps: ["Créer la fiche intervenant de Camille Roux", "Coller la bio validée par Sarah", "Prévenir Sarah que la fiche est en ligne"],
    draft: `Salut Sarah,\n\nC’est fait côté contenu : la fiche de Camille est en ligne sans photo pour l’instant, je l’ajoute dès réception.\n\n${SIGN_TU}` });

  thread("a:wordfence mises à jour requises", "Alertes sites", [
    ["in", "wf", 96, "[Wordfence] Mises à jour requises sur 2 plugins — novasummit.example.com",
      `Wordfence a détecté 2 plugins à mettre à jour sur novasummit.example.com :\n\n- Event Calendar Pro 5.1.9 → 5.2.1 (vulnérabilité CSRF, gravité moyenne)\n- Forms Plus 3.4.0 → 3.4.2\n\nConnectez-vous au tableau de bord WordPress pour appliquer les mises à jour.`],
    ["in", "wf", 20, "[Wordfence] Mises à jour requises sur 3 plugins — novasummit.example.com",
      `Wordfence a détecté 3 plugins à mettre à jour sur novasummit.example.com :\n\n- Event Calendar Pro 5.1.9 → 5.2.1 (vulnérabilité CSRF, corrigée dans la 5.2.1)\n- Forms Plus 3.4.0 → 3.4.2 (faille XSS stockée, gravité élevée)\n- SEO Boost 2.1.0 → 2.1.1\n\nVulnérabilité critique : appliquez les mises à jour dans les plus brefs délais.`],
  ]);
  task({ key: "a:wordfence mises à jour requises", kind: "a_faire", prio: "haute", dl: 0, dlt: "estimee", who: "wf", src: "claude", conf: 0.93, lot: "Sécurité WordPress", created: 19,
    title: "Mettre à jour 3 plugins vulnérables sur novasummit (CSRF, XSS)",
    summary: "Un seul rapport consolidé : Event Calendar Pro (CSRF), Forms Plus (XSS stockée) et SEO Boost sont à mettre à jour.",
    ev: "Vulnérabilité critique : appliquez les mises à jour dans les plus brefs délais",
    steps: ["Sauvegarder le site", "Mettre à jour Event Calendar Pro, Forms Plus et SEO Boost", "Tester le formulaire d’inscription et le calendrier", "Relancer un scan Wordfence"],
    draft: null });

  thread("a:site monitor mise à jour wordpress", "Alertes sites", [
    ["in", "wpm", 40, "Mise à jour de WordPress 6.8.3 disponible — novafestival.example.com",
      `Une mise à jour de sécurité de WordPress est disponible pour novafestival.example.com (6.8.2 → 6.8.3).\n\nCette version corrige 3 vulnérabilités. Nous vous recommandons de l’installer rapidement.`],
  ]);
  task({ key: "a:site monitor mise à jour wordpress", kind: "a_faire", prio: "moyenne", dl: 2, dlt: "estimee", who: "wpm", src: "local", conf: 0.66, lot: "Sécurité WordPress",
    title: "Traiter : Mise à jour de WordPress 6.8.3 disponible — novafestival",
    summary: "Mise à jour de sécurité de WordPress (6.8.2 → 6.8.3) disponible pour le site Festival.",
    ev: "Cette version corrige 3 vulnérabilités",
    steps: ["Relire la demande", "Faire le nécessaire", "Confirmer que c’est fait"], draft: null });

  thread("a:certificat ssl expire", "Alertes sites", [
    ["in", "hostmon", 30, "Votre certificat SSL pour billetterie.novasummit.example.com expire dans 12 jours",
      `Le certificat SSL de billetterie.novasummit.example.com expirera dans 12 jours.\n\nLe renouvellement automatique a échoué (erreur de validation DNS). Merci de vérifier l’enregistrement DNS ou de lancer un renouvellement manuel depuis votre espace client.`],
  ]);
  task({ key: "a:certificat ssl expire", kind: "a_faire", prio: "haute", dl: 5, dlt: "estimee", who: "hostmon", src: "ia", conf: 0.82, lot: "Sécurité WordPress",
    title: "Corriger le renouvellement automatique du certificat SSL de la billetterie",
    summary: "Le renouvellement du certificat a échoué (validation DNS) : la billetterie passerait en erreur HTTPS dans 12 jours.",
    ev: "Le renouvellement automatique a échoué (erreur de validation DNS)",
    steps: ["Vérifier l’enregistrement DNS de la billetterie", "Relancer le renouvellement depuis l’espace client Hostline", "Contrôler la date d’expiration du nouveau certificat"], draft: null });

  /* ---------- Cette semaine : logos, transferts, engagements, attentes ---------- */
  thread("s:logos sponsors pack v3", "Projets / Nova Summit", [
    ["in", "yanis", 28, "Nouveaux logos sponsors (pack v3)",
      `Hello Charles,\n\nJe t’ai exporté le pack v3 des logos sponsors (SVG + PNG @2x). Peux-tu remplacer ceux de la page Sponsors ? Les anciens ont un fond blanc qui jure avec le nouveau thème.\n\nYanis`, true],
  ]);
  task({ key: "s:logos sponsors pack v3", kind: "a_faire", prio: "moyenne", dl: 1, dlt: "estimee", who: "yanis", src: "ia", conf: 0.84, lot: "Logos partenaires",
    title: "Remplacer les logos de la page Sponsors (pack v3)",
    summary: "Yanis fournit le pack v3 (SVG + PNG @2x) : les anciens logos ont un fond blanc qui détonne avec le nouveau thème.",
    ev: "Peux-tu remplacer ceux de la page Sponsors ?",
    steps: ["Relire la demande et les pièces jointes", "Remplacer les logos dans la médiathèque et sur la page Sponsors", "Vérifier le rendu en thème clair et sombre", "Répondre à Yanis pour confirmer"],
    draft: `Hello Yanis,\n\nMerci pour le pack v3, je remplace les logos sur la page Sponsors et je te fais un retour avec une capture.\n\n${SIGN_TU}` });

  thread("s:logo alto sports", "Projets / Nova Summit", [
    ["in", "marc", 60, "Logo Alto Sports pour votre site",
      `Bonjour Charles,\n\nSuite à notre accord de sponsoring, voici le logo d’Alto Sports. Pourriez-vous l’ajouter sur la page Sponsors, catégorie « Partenaire officiel » ?\n\nBien cordialement,\nMarc Dubois\nAlto Sports`, true],
    ["out", "marc", 40, "RE: Logo Alto Sports pour votre site",
      `Bonjour Marc,\n\nMerci, bien reçu. Le logo fourni est en basse résolution : auriez-vous une version vectorielle (SVG) ou un PNG de 800 px minimum ?\n\nBien cordialement,\nCharles Atangui`],
  ]);
  task({ key: "s:logo alto sports", kind: "en_attente", prio: "moyenne", dl: 1, dlt: "estimee", who: "marc", src: "local", conf: 0.6, lot: "Logos partenaires",
    title: "Relancer Marc si pas de réponse : logo HD d’Alto Sports",
    summary: "J’attends d’Alto Sports une version vectorielle ou un PNG de 800 px minimum du logo.",
    ev: "auriez-vous une version vectorielle (SVG) ou un PNG de 800 px minimum ?",
    steps: ["Attendre la réponse de Marc", "Relancer Marc si rien n’est arrivé"],
    draft: `Bonjour Marc,\n\nJe me permets de revenir vers vous au sujet de mon précédent message : avez-vous pu retrouver une version haute définition du logo ?\n\n${SIGN_VOUS}` });

  thread("s:facture hostline octobre", "Boîte de réception", [
    ["in", "nora", 22, "Facture Hostline octobre — validation",
      `Bonjour Charles,\n\nJe reçois la facture Hostline d’octobre (1 248 € HT, soit +18 % par rapport à septembre à cause de l’option sauvegarde). Peux-tu me confirmer qu’elle est conforme ? Sinon je la transmets à Hugo pour arbitrage.\n\nNora`],
  ]);
  task({ key: "s:facture hostline octobre", kind: "a_transferer", prio: "moyenne", dl: 4, dlt: "estimee", who: "nora", src: "ia", conf: 0.74,
    deleg: ["Hugo Bernard", "Sujet de son périmètre : budget, facturation, hébergement, décisions"],
    title: "Répondre à Nora : facture Hostline d’octobre (+18 %), à confier à Hugo",
    summary: "La facture d’octobre augmente de 18 % à cause de l’option sauvegarde ; Nora demande une validation avant de payer.",
    ev: "Peux-tu me confirmer qu’elle est conforme ?",
    steps: ["Vérifier l’option sauvegarde facturée", "Transférer la décision à Hugo", "Prévenir Nora"],
    draft: `Bonjour Nora,\n\nMerci pour l’alerte. L’option sauvegarde a bien été activée en septembre, mais la validation du budget revient à Hugo : je lui transfère la facture.\n\n${SIGN_TU}` });

  thread("s:bannière festival", "Boîte de réception", [
    ["in", "sarah", 36, "Bannière pour la page Festival",
      `Charles, peux-tu nous préparer une bannière 1200×300 pour la page Festival avec le nouveau visuel ? Il me la faudrait en fin de semaine.\n\nSarah`],
  ]);
  task({ key: "s:bannière festival", kind: "a_transferer", prio: "moyenne", dl: 3, dlt: "estimee", who: "sarah", src: "ia", conf: 0.8,
    deleg: ["Yanis Petit", "Sujet de son périmètre : visuels, logos partenaires, bannières"],
    title: "Répondre à Sarah : bannière 1200×300 pour la page Festival",
    summary: "Sarah veut une bannière aux nouvelles couleurs en fin de semaine ; c’est un sujet de graphisme.",
    ev: "peux-tu nous préparer une bannière 1200×300 pour la page Festival",
    steps: ["Transmettre le besoin et le visuel à Yanis", "Prévenir Sarah du délai"],
    draft: `Salut Sarah,\n\nLes bannières, c’est le domaine de Yanis : je lui transfère ta demande avec le visuel. Il te dira directement pour la fin de semaine.\n\n${SIGN_TU}` });

  thread("s:partenariat média", "Boîte de réception", [
    ["in", "julien", 18, "Proposition de partenariat média — Nova Summit",
      `Bonjour,\n\nJe suis responsable des partenariats chez MediaFlux. Nous aimerions proposer un échange de visibilité (bannières + newsletter) autour du Nova Summit. Qui serait le bon interlocuteur ?\n\nCordialement,\nJulien Garnier`],
  ]);
  task({ key: "s:partenariat média", kind: "a_transferer", prio: "basse", dl: 5, dlt: "estimee", who: "julien", src: "ia", conf: 0.71,
    deleg: ["Sarah Cohen", "Sujet de son périmètre : contenus des événements, intervenants, partenariats"],
    title: "Orienter la demande de partenariat média de MediaFlux vers Sarah",
    summary: "MediaFlux propose un échange de visibilité et demande le bon interlocuteur.",
    ev: "Qui serait le bon interlocuteur ?",
    steps: ["Transférer le mail à Sarah", "Répondre à Julien Garnier en mettant Sarah en copie"],
    draft: `Bonjour Julien,\n\nMerci pour votre proposition. Sarah Cohen, responsable communication, est la bonne interlocutrice : je la mets en copie de ce message.\n\n${SIGN_VOUS}` });

  thread("s:comparatif hébergeurs", "Projets / Budget 2027", [
    ["in", "hugo", 75, "Budget hébergement 2027",
      `Charles, pour le budget 2027 j’aurais besoin d’un comparatif des offres d’hébergement (Hostline et alternatives) avec les coûts de migration. Tu peux me faire ça ?\n\nHugo`],
    ["out", "hugo", 70, "RE: Budget hébergement 2027",
      `Salut Hugo,\n\nOui, je te fais un retour avec un comparatif ${wd(2)} au plus tard.\n\nCharles`],
  ]);
  task({ key: "s:comparatif hébergeurs", kind: "engagement", prio: "moyenne", dl: 2, dlt: "explicite", who: "hugo", src: "claude", conf: 0.81,
    title: "Envoyer à Hugo le comparatif des offres d’hébergement 2027",
    summary: `Promesse faite à Hugo : un comparatif Hostline et alternatives, avec coûts de migration, d’ici ${wd(2)}.`,
    ev: `je te fais un retour avec un comparatif ${wd(2)} au plus tard`,
    steps: ["Lister 3 hébergeurs candidats et leurs tarifs", "Estimer le coût et la durée d’une migration", "Envoyer le tableau comparatif à Hugo"],
    draft: `Salut Hugo,\n\nComme promis, voici le comparatif des offres d’hébergement pour 2027 : …\n\n${SIGN_TU}` });

  thread("s:liste des pages à relire", "Boîte de réception", [
    ["in", "sarah", 30, "Relecture du site avant l’ouverture des inscriptions",
      `Peux-tu m’envoyer la liste des pages à relire pour que je répartisse avec l’équipe ?\n\nSarah`],
    ["out", "sarah", 26, "RE: Relecture du site avant l’ouverture des inscriptions",
      `Je t’envoie ça demain, promis.\n\nCharles`],
  ]);
  task({ key: "s:liste des pages à relire", kind: "engagement", prio: "moyenne", dl: 0, dlt: "explicite", who: "sarah", src: "ia", conf: 0.76,
    title: "Envoyer à Sarah la liste des pages à relire",
    summary: "Promesse faite à Sarah : la liste des pages du site à relire avant l’ouverture des inscriptions.",
    ev: "Je t’envoie ça demain, promis.",
    steps: ["Exporter la liste des pages publiées", "Envoyer la liste à Sarah"],
    draft: `Salut Sarah,\n\nComme promis, voici la liste des pages à relire avant l’ouverture des inscriptions : …\n\n${SIGN_TU}` });

  thread("t:ticket #4790", "Support / Hostline", [
    ["in", "hostline", 90, "[Hostline] Ticket #4790 — Restauration de sauvegarde du site Festival (Waiting for reply: Customer)",
      `Bonjour,\n\nPouvez-vous préciser la date de la sauvegarde à restaurer pour le site novafestival.example.com ?\n\nCordialement,\nSupport Hostline`],
    ["out", "hostline", 48, "RE: [Hostline] Ticket #4790 — Restauration de sauvegarde du site Festival (Waiting for reply: Provider)",
      `Bonjour,\n\nIl s’agit de la sauvegarde du début du mois dernier, avant le déploiement du nouveau thème.\n\nCordialement,\nCharles Atangui`],
    ["in", "hostline", 30, "[Hostline] Ticket #4790 — Restauration de sauvegarde du site Festival (Waiting for reply: Provider)",
      `Bonjour,\n\nNous avons bien reçu votre précision et préparons la restauration. Nous revenons vers vous dès que le site est restauré en préproduction.\n\nCordialement,\nSupport Hostline`],
  ]);
  task({ key: "t:ticket #4790", kind: "en_attente", prio: "moyenne", dl: 2, dlt: "estimee", who: "hostline", src: "local", conf: 0.7,
    title: "Ticket 4790 — Attendre la réponse du support : restauration de la sauvegarde du site Festival",
    summary: "Hostline prépare la restauration en préproduction et reviendra vers nous.",
    ev: "Nous revenons vers vous dès que le site est restauré en préproduction",
    steps: ["Attendre la réponse de Hostline", "Relancer Hostline si rien n’est arrivé"], draft: null });

  thread("s:photo hd camille", "Boîte de réception", [
    ["out", "camille", 45, "Photo HD pour votre fiche intervenante",
      `Bonjour Camille,\n\nPourriez-vous m’envoyer une photo en haute résolution (au moins 1200 px de large) pour votre fiche sur la page Intervenants ?\n\nMerci d’avance,\nCharles Atangui`],
  ]);
  task({ key: "s:photo hd camille", kind: "en_attente", prio: "basse", dl: 3, dlt: "estimee", who: "camille", src: "local", conf: 0.6,
    title: "Relancer Camille si pas de réponse : photo HD pour la page Intervenants",
    summary: "J’attends la photo en haute résolution de Camille Roux pour finaliser sa fiche.",
    ev: "Pourriez-vous m’envoyer une photo en haute résolution",
    steps: ["Attendre la réponse de Camille", "Relancer Camille si rien n’est arrivé"],
    draft: `Bonjour Camille,\n\nJe me permets de revenir vers vous au sujet de mon précédent message : avez-vous pu avancer ?\n\nMerci,\nCharles Atangui` });

  /* ---------- À trier (pour info) ---------- */
  thread("s:cr réunion de lancement", "Projets / Nova Summit", [
    ["in", "lea", 60, "Compte rendu — réunion de lancement Nova Summit",
      `Bonjour à tous,\n\nCompte rendu de la réunion de lancement : ouverture des inscriptions la semaine prochaine, programme complet en ligne avant la fin du mois, newsletter « Dernières places » en suivant. Pas d’action particulière pour toi, mais bon à savoir.\n\nLéa`],
  ]);
  task({ key: "s:cr réunion de lancement", kind: "info", prio: "basse", dl: null, who: "lea", src: "ia", conf: 0.42,
    title: "À lire : Compte rendu — réunion de lancement Nova Summit",
    summary: "Calendrier de lancement : inscriptions la semaine prochaine, programme complet avant la fin du mois.", ev: "Pas d’action particulière pour toi, mais bon à savoir.", steps: [] });

  thread("s:planning de maintenance hostline", "Support / Hostline", [
    ["in", "hostline", 50, "Maintenance planifiée sur vos serveurs — " + wd(4),
      `Bonjour,\n\nUne maintenance est planifiée ${wd(4)} entre 2 h et 4 h du matin. Vos sites peuvent être indisponibles quelques minutes. Aucune action n’est nécessaire de votre part.\n\nSupport Hostline`],
  ]);
  task({ key: "s:planning de maintenance hostline", kind: "info", prio: "basse", dl: null, who: "hostline", src: "local", conf: 0.4,
    title: `À lire : Maintenance planifiée sur vos serveurs — ${wd(4)}`,
    summary: `Maintenance Hostline ${wd(4)} entre 2 h et 4 h, indisponibilité de quelques minutes possible.`, ev: "Aucune action n’est nécessaire de votre part.", steps: [] });

  thread("s:retour des testeurs billetterie", "Boîte de réception", [
    ["in", "sarah", 100, "Retour des testeurs sur la billetterie",
      `Salut Charles,\n\nLes testeurs ont trouvé la billetterie claire, deux remarques sur le libellé du bouton « Valider ». Je te les note dans le Drive, rien d’urgent.\n\nSarah`],
  ]);
  task({ key: "s:retour des testeurs billetterie", kind: "info", prio: "basse", dl: null, who: "sarah", src: "ia", conf: 0.38,
    title: "À lire : Retour des testeurs sur la billetterie",
    summary: "Billetterie jugée claire ; deux remarques sur le libellé du bouton de validation, rien d’urgent.", ev: "rien d’urgent", steps: [] });

  /* ---------- Revue de l'historique (reçues avant la mise en service) ---------- */
  thread("s:police du nouveau thème", "Boîte de réception", [
    ["in", "lea", 15 * 24, "Police du nouveau thème", `Charles, entre Sora et Inter pour le nouveau thème, tu en penses quoi ? On doit trancher cette semaine.\n\nLéa`],
  ]);
  task({ key: "s:police du nouveau thème", kind: "a_faire", prio: "moyenne", who: "lea", src: "ia", conf: 0.6,
    title: "Répondre à Léa : choix de la police du nouveau thème", summary: "Léa demande un avis entre deux polices pour le nouveau thème.", ev: "entre Sora et Inter pour le nouveau thème, tu en penses quoi ?",
    steps: ["Comparer les deux polices sur la page d’accueil", "Répondre à Léa"], draft: `Bonjour Léa,\n\nMerci pour ton message, je m’en occupe et je te reviens rapidement.\n\n${SIGN_TU}` });

  thread("s:fenêtre de maintenance", "Support / Hostline", [
    ["in", "hostline", 16 * 24, "Confirmation de la fenêtre de maintenance", `Bonjour,\n\nMerci de nous confirmer la fenêtre de maintenance souhaitée pour la bascule de vos serveurs.\n\nSupport Hostline`],
  ]);
  task({ key: "s:fenêtre de maintenance", kind: "a_faire", prio: "basse", who: "hostline", src: "local", conf: 0.55,
    title: "Répondre à Hostline : fenêtre de maintenance souhaitée", summary: "Hostline demande de confirmer la fenêtre de maintenance pour la bascule.", ev: "Merci de nous confirmer la fenêtre de maintenance souhaitée",
    steps: ["Relire la demande", "Répondre à Hostline pour confirmer"], draft: `Bonjour,\n\nMerci pour votre message, je m’en occupe et je vous reviens rapidement.\n\n${SIGN_VOUS}` });

  thread("s:mentions légales billetterie", "Boîte de réception", [
    ["in", "sarah", 26 * 24, "Mentions légales de la page Billetterie", `Charles, peux-tu valider le texte des mentions légales de la page Billetterie avant qu’on l’envoie à la juriste ?\n\nSarah`],
  ]);
  task({ key: "s:mentions légales billetterie", kind: "a_faire", prio: "moyenne", who: "sarah", src: "ia", conf: 0.58,
    title: "Valider les mentions légales de la page Billetterie", summary: "Sarah demande une validation du texte avant relecture juridique.", ev: "peux-tu valider le texte des mentions légales de la page Billetterie",
    steps: ["Relire le texte des mentions légales", "Répondre à Sarah"], draft: `Bonjour Sarah,\n\nMerci pour ton message, je m’en occupe et je te reviens rapidement.\n\n${SIGN_TU}` });

  thread("s:brief bannière festival", "Boîte de réception", [
    ["in", "yanis", 34 * 24, "Brief de la bannière Festival", `Charles, tu me passes le brief de la bannière Festival (dimensions, texte, date) ? Je démarre la semaine prochaine.\n\nYanis`],
  ]);
  task({ key: "s:brief bannière festival", kind: "a_faire", prio: "basse", who: "yanis", src: "ia", conf: 0.52,
    title: "Envoyer le brief de la bannière Festival à Yanis", summary: "Yanis attend les dimensions, le texte et la date pour démarrer la bannière.", ev: "tu me passes le brief de la bannière Festival",
    steps: ["Rédiger le brief (dimensions, texte, date)", "Envoyer le brief à Yanis"], draft: `Hello Yanis,\n\nVoici le brief de la bannière Festival : …\n\n${SIGN_TU}` });

  thread("s:contrat de sponsoring", "Boîte de réception", [
    ["out", "marc", 45 * 24, "Contrat de sponsoring Alto Sports", `Bonjour Marc,\n\nPourriez-vous me renvoyer le contrat de sponsoring signé afin que je publie le logo sur le site ?\n\nBien cordialement,\nCharles Atangui`],
  ]);
  task({ key: "s:contrat de sponsoring", kind: "en_attente", prio: "basse", who: "marc", src: "local", conf: 0.5,
    title: "Relancer Marc si pas de réponse : contrat de sponsoring signé", summary: "J’attends le contrat signé d’Alto Sports avant de publier le logo.", ev: "Pourriez-vous me renvoyer le contrat de sponsoring signé",
    steps: ["Attendre la réponse de Marc", "Relancer Marc si rien n’est arrivé"], draft: `Bonjour Marc,\n\nJe me permets de revenir vers vous au sujet de mon précédent message : avez-vous pu avancer ?\n\n${SIGN_VOUS}` });

  thread("s:accès analytics anciens sites", "Boîte de réception", [
    ["in", "hugo", 61 * 24, "Accès Analytics des anciens sites", `Charles, peux-tu me redonner les accès Analytics des anciens sites pour l’audit de clôture ?\n\nHugo`],
  ]);
  task({ key: "s:accès analytics anciens sites", kind: "a_faire", prio: "basse", who: "hugo", src: "ia", conf: 0.5,
    title: "Répondre à Hugo : accès Analytics des anciens sites", summary: "Hugo demande les accès Analytics des anciens sites pour l’audit de clôture.", ev: "peux-tu me redonner les accès Analytics des anciens sites",
    steps: ["Retrouver les accès", "Répondre à Hugo"], draft: `Salut Hugo,\n\nMerci pour ton message, je m’en occupe et je te reviens rapidement.\n\n${SIGN_TU}` });

  /* ---------- Reportée ---------- */
  thread("a:domaine à renouveler", "Alertes sites", [
    ["in", "hostmon", 100, "Votre nom de domaine novafestival.example.com arrive à échéance",
      `Votre nom de domaine novafestival.example.com arrive à échéance dans 10 jours. Pensez à le renouveler depuis votre espace client pour éviter toute interruption.`],
  ]);
  task({ key: "a:domaine à renouveler", kind: "a_faire", prio: "basse", dl: 10, dlt: "explicite", who: "hostmon", src: "ia", conf: 0.8,
    snooze: (() => { const d = new Date(); d.setDate(d.getDate() + 3); return `${ymd(d)}T09:00`; })(),
    title: "Renouveler le nom de domaine novafestival.example.com", summary: "Le domaine du site Festival arrive à échéance dans 10 jours.", ev: "Pensez à le renouveler depuis votre espace client",
    steps: ["Renouveler le domaine depuis l’espace client", "Contrôler la nouvelle date d’échéance"], draft: null });

  /* ---------- Terminées ---------- */
  thread("s:article programme", "Projets / Nova Summit", [
    ["in", "lea", 30, "Article « Programme du Nova Summit »", `Charles, l’article du programme est validé, tu peux publier.\n\nLéa`],
    ["out", "lea", 3, "RE: Article « Programme du Nova Summit »", `C’est publié, voici le lien : novasummit.example.com/programme\n\nCharles`],
  ]);
  task({ key: "s:article programme", kind: "a_faire", prio: "moyenne", who: "lea", src: "ia", conf: 0.85, status: "fait", created: 29, updated: 3,
    title: "Publier l’article « Programme du Nova Summit »", summary: "Léa a validé l’article, à publier.", ev: "l’article du programme est validé, tu peux publier", steps: [], notes: "[traité dans le fil]" });

  thread("s:planning de recette", "Boîte de réception", [
    ["in", "lea", 28, "Planning de recette", `Tu peux me confirmer les créneaux de recette de cette semaine ?\n\nLéa`],
    ["out", "lea", 4, "RE: Planning de recette", `Ok pour mardi et jeudi matin.\n\nCharles`],
  ]);
  task({ key: "s:planning de recette", kind: "a_faire", prio: "moyenne", who: "lea", src: "ia", conf: 0.8, status: "fait", created: 27, updated: 4,
    title: "Répondre à Léa : planning de recette", summary: "Léa demande de confirmer les créneaux de recette.", ev: "Tu peux me confirmer les créneaux de recette de cette semaine ?", steps: [], notes: "[répondu dans le fil]" });

  thread("a:forms plus mise à jour", "Alertes sites", [
    ["in", "wf", 40, "[Wordfence] Mise à jour requise : Forms Plus 3.3.9 → 3.4.0", `Forms Plus 3.4.0 corrige une faille XSS. Mettez à jour dès que possible.`],
  ]);
  task({ key: "a:forms plus mise à jour", kind: "a_faire", prio: "haute", who: "wf", src: "local", conf: 0.8, status: "fait", created: 39, updated: 5, lot: "Sécurité WordPress",
    title: "Mettre à jour le plugin Forms Plus (faille XSS)", summary: "Forms Plus 3.4.0 corrige une faille XSS.", ev: "Forms Plus 3.4.0 corrige une faille XSS", steps: [] });

  thread("t:ticket #4815", "Support / Hostline", [
    ["in", "hostline", 80, "[Hostline] Ticket #4815 — Lenteurs sur novasummit.example.com (Waiting for reply: Customer)", `Bonjour,\n\nPouvez-vous nous indiquer les heures auxquelles vous constatez des lenteurs ?\n\nSupport Hostline`],
    ["out", "hostline", 60, "RE: [Hostline] Ticket #4815 — Lenteurs sur novasummit.example.com (Waiting for reply: Provider)", `Bonjour,\n\nPrincipalement entre 9 h et 10 h, au moment de l’envoi des newsletters.\n\nCharles Atangui`],
    ["in", "hostline", 26, "[Hostline] Ticket #4815 — Lenteurs sur novasummit.example.com (Resolved)", `Bonjour,\n\nNous avons augmenté les ressources de votre offre. Le ticket est résolu.\n\nSupport Hostline`],
  ]);
  task({ key: "t:ticket #4815", kind: "a_faire", prio: "moyenne", who: "hostline", src: "local", conf: 0.7, status: "fait", created: 80, updated: 26,
    title: "Ticket 4815 — Répondre à Hostline : lenteurs de novasummit", summary: "Ticket résolu par Hostline.", ev: "Le ticket est résolu.", steps: [], notes: "[ticket résolu]" });

  thread("s:relecture newsletter octobre", "Newsletters", [
    ["in", "ines", 60, "Relecture de la newsletter d’octobre", `Peux-tu relire la newsletter avant l’envoi ?\n\nInès`],
    ["out", "ines", 50, "RE: Relecture de la newsletter d’octobre", `Relue, deux coquilles corrigées. Tu peux envoyer.\n\nCharles`],
  ]);
  task({ key: "s:relecture newsletter octobre", kind: "a_faire", prio: "moyenne", who: "ines", src: "ia", conf: 0.8, status: "fait", created: 59, updated: 50,
    title: "Relire la newsletter d’octobre", summary: "Inès demande une relecture avant l’envoi.", ev: "Peux-tu relire la newsletter avant l’envoi ?", steps: [], notes: "[répondu dans le fil]" });

  thread("s:sauvegarde automatique festival", "Alertes sites", [
    ["in", "wpm", 30, "Sauvegarde automatique du site Festival terminée", `La sauvegarde automatique de novafestival.example.com s’est terminée avec succès.`],
  ]);
  task({ key: "s:sauvegarde automatique festival", kind: "info", prio: "basse", who: "wpm", src: "local", conf: 0.3, status: "ignore", created: 30, updated: 22,
    title: "À lire : Sauvegarde automatique du site Festival terminée", summary: "Sauvegarde terminée avec succès, rien à faire.", ev: "s’est terminée avec succès", steps: [] });

  /* ===================== État du moteur simulé ===================== */
  const INSTALLED = ago(12 * 24);
  const ENGINE = { me: P.me.name.split(" ")[0], decisions: 87, examples: 412, calls: 2, tokens_in: 6840, tokens_out: 790, cost: 0.0094,
    today: { local: 3, ia: 5, claude: 1 }, pending: 1, reading: false, busy: false, step: "", messages: 1284, threads: 417,
    last_scan: new Date(Date.now() - 40e3).toISOString(), last_analysis: ago(0.3), excluded: new Set(["Courrier indésirable", "Éléments supprimés", "Brouillons", "Archives"]) };

  /* ----- Journal (affiché dans les terminaux du thème Spatial) ----- */
  const LOG = [];
  let seq = 57;
  function log(verb, text) {
    seq++;
    LOG.push({ n: seq, verb, text: String(text).replace(/\s+/g, " ").slice(0, 90), at: hms() });
    if (LOG.length > 80) LOG.shift();
  }
  [["sync", "3 nouveaux mails · 3 fils analysés"], ["lire", "Léa Martin · Page Programme — créneaux journée 2"],
   ["règles", "Page Programme — créneaux journée 2 → à faire · ia en file"], ["ia lit", "Page Programme — créneaux journée 2"],
   ["ia", "à faire + à faire · 14 s"], ["lire", "Hostline Support · [Hostline] Ticket #4790 — Restauration de sauvegarde"],
   ["règles", "Ticket 4790 — Restauration de sauvegarde → en attente"], ["écarter", "Event Weekly · newsletter"],
   ["lire", "Sarah Cohen · Relecture du site avant l’ouverture des inscriptions"], ["règles", "Relecture du site → engagement · ia en file"],
   ["ia lit", "Relecture du site avant l’ouverture des inscriptions"], ["ia", "engagement · 9 s"], ["apprendre", "+1 décision (fait)"],
   ["zéro oubli", "Sarah · Formulaire d’inscription en erreur"], ["lire", "Wordfence · Mises à jour requises sur 3 plugins"],
   ["règles", "Mises à jour requises sur # plugins → à faire"], ["✦ claude", "analyse d’un fil à la demande"]].forEach(([v, t]) => log(v, t));

  const FEED = [["lire", "Hostline Support · [Hostline] Ticket #4790 — Restauration de sauvegarde"], ["règles", "Ticket 4790 → en attente · ia en file"],
    ["ia lit", "Ticket 4790 — Restauration de sauvegarde"], ["ia", "en attente · 8 s"], ["écarter", "Event Weekly · newsletter"],
    ["lire", "Yanis Petit · Nouveaux logos sponsors (pack v3)"], ["règles", "Nouveaux logos sponsors → à faire · ia en file"],
    ["ia lit", "Nouveaux logos sponsors (pack v3)"], ["ia", "à faire · 12 s"], ["écarter", "Nouvelle inscription · formulaire"],
    ["zéro oubli", "Nora · Facture Hostline octobre"], ["apprendre", "+1 décision (reclassement)"], ["lire", "Marc Dubois · Logo Alto Sports pour votre site"],
    ["règles", "Logo Alto Sports → en attente"]];
  let feedI = 0;
  function feed() {
    const [verb, text] = FEED[feedI++ % FEED.length];
    log(verb, text);
    if (/ia en file/.test(text)) ENGINE.pending++;
    if (verb === "ia lit") { ENGINE.reading = true; setTimeout(() => (ENGINE.reading = false), 5200); }
    if (verb === "ia") ENGINE.pending = Math.max(0, ENGINE.pending - 1);
  }
  setInterval(feed, 6500);

  /* ===================== Vues, comptages (même logique que server.py) ===================== */
  const OPEN = ["a_faire", "en_cours", "en_attente", "delegue"];
  const PRIO = { haute: 0, moyenne: 1, basse: 2 };
  const isOpen = (r, c) => OPEN.includes(r.status) && (!r.snooze_until || r.snooze_until <= c.now);
  const acts = (r) => ["a_faire", "a_transferer", "engagement"].includes(r.kind);
  const review = (r, c) => isOpen(r, c) && r.kind !== "info" && !r.reviewed && new Date(r.last_date) < c.inst;
  const VIEW = {
    focus: (r, c) => isOpen(r, c) && acts(r) && ((r.deadline && r.deadline <= c.soon) || r.priority === "haute" || new Date(r.created_at) >= c.fresh),
    retard: (r, c) => isOpen(r, c) && r.kind !== "info" && r.deadline && r.deadline < c.today,
    tout: (r, c) => isOpen(r, c) && r.kind !== "info",
    a_faire: (r, c) => isOpen(r, c) && r.kind === "a_faire",
    a_transferer: (r, c) => isOpen(r, c) && r.kind === "a_transferer",
    engagement: (r, c) => isOpen(r, c) && r.kind === "engagement",
    en_attente: (r, c) => isOpen(r, c) && (r.kind === "en_attente" || r.status === "en_attente"),
    semaine: (r, c) => isOpen(r, c) && r.kind !== "info" && r.deadline && r.deadline <= c.week,
    revue: review,
    probables: (r, c) => review(r, c) && new Date(r.last_date) < c.old,
    info: (r, c) => r.kind === "info" && !["fait", "ignore"].includes(r.status) && new Date(r.last_date) >= c.recent,
    reportes: (r, c) => OPEN.includes(r.status) && r.snooze_until && r.snooze_until > c.now,
    fait: (r) => ["fait", "ignore"].includes(r.status),
  };
  const ctx = () => ({ today: day(0), soon: day(3), week: day(7), now: nowLocal(), inst: new Date(INSTALLED),
    old: new Date(Date.now() - 21 * 24 * HOUR), recent: new Date(Date.now() - 14 * 24 * HOUR), fresh: new Date(Date.now() - 36 * HOUR) });

  function row(t) {
    const ms = MSGS[t.thread_key], last = ms[ms.length - 1], r = clone(t);
    delete r._who;
    return Object.assign(r, { thread_subject: last.subject, last_from: last.from_name || last.from_addr, last_date: last.date_utc,
      msg_count: ms.length, folder: FOLDER[t.thread_key], _w: t._who });
  }
  const rows = () => TASKS.map(row);

  function listTasks(view, q, lot) {
    const c = ctx(), pred = VIEW[view] || VIEW.tout;
    let out = rows().filter((r) => pred(r, c));
    if (q) { const n = norm(q); out = out.filter((r) => [r.title, r.summary, r.thread_subject, r.last_from, r.lot, (P[r._w] || {}).name].some((v) => norm(v).includes(n))); }
    if (lot) out = out.filter((r) => r.lot === lot);
    if (view === "fait") out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    else out.sort((a, b) => (!a.deadline - !b.deadline) || (a.deadline || "").localeCompare(b.deadline || "") || (PRIO[a.priority] - PRIO[b.priority]) || (a.last_date < b.last_date ? 1 : -1));
    out.forEach((r) => delete r._w);
    return out.slice(0, 400);
  }

  function counts() {
    const c = ctx(), all = rows();
    return Object.fromEntries(Object.entries(VIEW).map(([name, pred]) => [name, all.filter((r) => pred(r, c)).length]));
  }

  function lots() {
    const c = ctx(), by = {};
    rows().filter((r) => VIEW.tout(r, c) && r.lot).forEach((r) => (by[r.lot] = (by[r.lot] || 0) + 1));
    return Object.entries(by).map(([lot, n]) => ({ lot, n })).sort((a, b) => b.n - a.n);
  }

  function nextDeadline() {
    const c = ctx(), after18 = new Date().getHours() >= 18;
    const cand = rows().filter((r) => VIEW.tout(r, c) && r.deadline && r.deadline >= (after18 ? day(1) : day(0)))
      .sort((a, b) => a.deadline.localeCompare(b.deadline) || PRIO[a.priority] - PRIO[b.priority]);
    return cand[0] ? { id: cand[0].id, title: cand[0].title, deadline: cand[0].deadline } : null;
  }

  /* ----- Séries du bloc « Signal » et des barres « Mails reçus » (déterministes) ----- */
  const R = rng(20260);
  const SERIES = (() => {
    const received = [], created = [], done = [], days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const n = weekend ? 1 + Math.floor(R() * 3) : 8 + Math.floor(R() * 9);
      received.push(n); created.push(weekend ? Math.floor(R() * 2) : 2 + Math.floor(R() * 5)); done.push(weekend ? 0 : 1 + Math.floor(R() * 5));
      days.push(`${pad(d.getDate())}/${pad(d.getMonth() + 1)}`);
    }
    return { received, created, done, days };
  })();

  const USAGE = (() => {
    const out = [], r = rng(77), calls = [1, 0, 2, 0, 3, 2];   // 6 jours passés ; aujourd'hui vient de l'état en cours
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const c = i === 0 ? 0 : calls[6 - i];
      out.push({ day: ymd(d), calls: c, tokens_in: c * (3000 + Math.floor(r() * 900)), tokens_out: c * (330 + Math.floor(r() * 150)), cost: +(c * 0.0047).toFixed(4) });
    }
    return out;
  })();
  const usageToday = () => ({ day: ymd(new Date()), calls: ENGINE.calls, tokens_in: ENGINE.tokens_in, tokens_out: ENGINE.tokens_out, cost: ENGINE.cost });
  function claudeCall() {
    ENGINE.calls++; ENGINE.today.claude++;
    ENGINE.tokens_in += 3000 + Math.floor(Math.random() * 1200); ENGINE.tokens_out += 330 + Math.floor(Math.random() * 200); ENGINE.cost = +(ENGINE.cost + 0.0047).toFixed(4);
  }

  /* ===================== Réponses de l'API simulée ===================== */
  function apiState() {
    const all = rows(), c = ctx(), start = new Date(); start.setHours(0, 0, 0, 0);
    return {
      me: ENGINE.me, counts: counts(), lots: lots(),
      flux: SERIES.received.map((n, i) => ({ day: SERIES.days[i], n })),
      next: nextDeadline(),
      engine: { ok: true, message: "Claude connecté (simulation)" }, paused_until: null,
      usage_today: usageToday(), learning: { examples: ENGINE.examples, decisions: ENGINE.decisions },
      llm: { ok: true, message: "IA locale prête (qwen3:8b)" }, log: LOG.slice(-30), llm_reading: ENGINE.reading,
      signal: { received: SERIES.received, created: SERIES.created, done: SERIES.done },
      today: { ...ENGINE.today }, llm_pending: ENGINE.pending, busy: ENGINE.busy, step: ENGINE.step,
      last_scan: ENGINE.last_scan, last_analysis: ENGINE.last_analysis, installed_at: INSTALLED,
      messages: ENGINE.messages, threads: ENGINE.threads, pending: 0, noise: 156,
      done_today: all.filter((r) => r.status === "fait" && new Date(r.updated_at) >= start).length,
    };
  }

  const FOLDER_LIST = [["Boîte de réception", 842], ["Éléments envoyés", 311], ["Alertes sites", 96], ["Newsletters", 214], ["Projets / Budget 2027", 23],
    ["Projets / Festival Nova Lyon", 64], ["Projets / Nova Summit", 187], ["Support / Hostline", 58], ["Archives", 1203], ["Brouillons", 4],
    ["Courrier indésirable", 37], ["Éléments supprimés", 129]];
  const SYSTEM = /^(courrier ind|junk|éléments supprim|brouillons|archives)/i;
  const folders = () => FOLDER_LIST.map(([name, count]) => ({ name, count, excluded: ENGINE.excluded.has(name), system: SYSTEM.test(name) }));

  function update(ids, fields, note) {
    const ok = ["status", "deadline", "priority", "kind", "notes", "snooze_until", "delegate_to", "title", "reviewed", "lot"];
    const f = Object.fromEntries(Object.entries(fields || {}).filter(([k]) => ok.includes(k)));
    if (!ids.length || !Object.keys(f).length) return { ok: false };
    for (const id of ids) {
      const t = TASKS.find((x) => x.id === +id);
      if (!t) continue;
      Object.assign(t, f, { user_edited: 1, updated_at: new Date().toISOString() });
      if (note) t.notes = `${t.notes || ""} ${note}`.trim();
    }
    const what = { fait: "fait", ignore: "ignorer", delegue: "transférer" }[f.status];
    if (what || f.kind || f.priority) {
      ENGINE.decisions += ids.length;
      log("apprendre", `+${ids.length} décision${plural(ids.length, "", "s")} (${what || "reclassement"})`);
    }
    return { ok: true, n: ids.length };
  }

  /* ----- « Synchroniser » : fait arriver, un par un, quelques mails scénarisés ----- */
  const INCOMING = [
    { key: "s:maquette mobile billetterie", who: "yanis", subject: "Maquette mobile de la page Billetterie", folder: "Projets / Nova Summit", att: true,
      body: `Hello Charles,\n\nLa maquette mobile de la page Billetterie est prête (Figma en pièce jointe). Peux-tu l’intégrer pour la recette de ${wd(3)} ?\n\nYanis`,
      task: { kind: "a_faire", prio: "moyenne", dl: 3, title: "Intégrer la maquette mobile de la page Billetterie", summary: "Yanis fournit la maquette mobile à intégrer avant la recette.", ev: "Peux-tu l’intégrer pour la recette" } },
    { key: "t:ticket #4830", who: "hostmon", subject: "[Hostline] Ticket #4830 — Pic de trafic détecté sur novasummit.example.com (Waiting for reply: Customer)", folder: "Support / Hostline",
      body: `Bonjour,\n\nUn pic de trafic inhabituel (x6) a été détecté sur novasummit.example.com. Merci de confirmer s’il s’agit d’une campagne en cours, sinon nous activerons la protection anti-bot.\n\nSupport Hostline`,
      task: { kind: "a_faire", prio: "haute", dl: 0, title: "Ticket 4830 — Répondre à Hostline : pic de trafic (campagne en cours ?)", summary: "Hostline demande si le pic de trafic correspond à une campagne ; sinon protection anti-bot.", ev: "Merci de confirmer s’il s’agit d’une campagne en cours" } },
    { key: "s:accès stagiaire", who: "hugo", subject: "Accès WordPress pour la stagiaire", folder: "Boîte de réception",
      body: `Charles, la stagiaire communication arrive lundi : peux-tu lui créer un compte « Éditrice » sur novasummit et novafestival ?\n\nMerci,\nHugo`,
      task: { kind: "a_faire", prio: "moyenne", dl: 4, title: "Créer un compte Éditrice WordPress pour la stagiaire", summary: "Hugo demande deux comptes Éditrice pour l’arrivée de la stagiaire.", ev: "peux-tu lui créer un compte « Éditrice » sur novasummit et novafestival ?" } },
  ];

  async function sync() {
    ENGINE.busy = true; ENGINE.step = "Lecture des nouveaux mails…"; await sleep(550);
    ENGINE.step = "Analyse locale…"; await sleep(450);
    const item = INCOMING.shift();
    if (item) {
      const p = P[item.who];
      thread(item.key, item.folder, [["in", item.who, 0.02, item.subject, item.body, item.att]]);
      task({ key: item.key, who: item.who, src: "local", conf: 0.72, dlt: "estimee", created: 0.02,
        steps: ["Relire la demande", "Faire le nécessaire", `Répondre à ${p.name.split(" ")[0]} pour confirmer`], ...item.task });
      ENGINE.messages++; ENGINE.threads++; ENGINE.today.local++; ENGINE.pending++;
      ENGINE.last_analysis = new Date().toISOString();
      log("lire", `${p.name} · ${item.subject}`);
      log("règles", `${item.task.title} → à faire · ia en file`);
    }
    ENGINE.busy = false; ENGINE.step = ""; ENGINE.last_scan = new Date().toISOString();
    log("sync", item ? "1 nouveau mail · 1 fil analysé" : "0 nouveau mail · 0 fil analysé");
    return { ok: true, new: item ? 1 : 0, threads: item ? 1 : 0, tasks: item ? 1 : 0 };
  }

  /* ----- Boutons « ✦ Claude » : réponses prédéfinies après un faux délai ----- */
  function draftFor(t) {
    const p = P[t._who] || {}, first = p.org ? "" : (p.name || "").split(" ")[0], tu = !!p.tu;
    const hello = first ? `Bonjour ${first},` : "Bonjour,";
    const bye = tu ? SIGN_TU : SIGN_VOUS;
    const when = t.deadline && t.deadline >= day(0) ? ` d’ici ${longDay(t.deadline)}` : "";
    const [poss, toi, moi] = tu ? ["ton", "te", "t’"] : ["votre", "vous", "vous "];
    let body;
    if (t.kind === "en_attente") body = `Je me permets de revenir vers ${tu ? "toi" : "vous"} au sujet de mon précédent message : ${tu ? "as-tu" : "avez-vous"} pu avancer ? Cela me permettrait de finaliser le sujet${when}.`;
    else if (t.kind === "engagement") body = `Comme promis, voici le point sur « ${t.title} ». Je ${moi}envoie le détail${when}. ${tu ? "Dis-moi" : "Dites-moi"} si ${tu ? "tu veux" : "vous souhaitez"} relire avant publication.`;
    else body = `Merci pour ${poss} message. Je prends en charge « ${t.title} » et je ${toi} confirme que ce sera fait${when || " rapidement"}. Je ${toi} préviens dès que c’est en ligne pour que ${tu ? "tu puisses" : "vous puissiez"} vérifier de ${poss} côté.`;
    return { draft: `${hello}\n\n${body}\n\n${bye}`,
      steps: ["Relire la demande et ses pièces jointes", "Faire la modification en préproduction", "Vérifier le rendu puis publier", `Prévenir ${first || "l’interlocuteur"} que c’est fait`] };
  }

  async function draft(id) {
    await sleep(1100 + Math.random() * 500);
    const t = TASKS.find((x) => x.id === +id);
    if (!t) return { ok: false, message: "Tâche introuvable" };
    const d = draftFor(t);
    t.draft_reply = d.draft; t.steps = d.steps; t.updated_at = new Date().toISOString();
    claudeCall(); log("✦ claude", "rédaction d’une réponse à la demande");
    return { ok: true, message: "Réponse rédigée par Claude (simulation)" };
  }

  async function reanalyze(key) {
    await sleep(1300 + Math.random() * 500);
    const mine = TASKS.filter((t) => t.thread_key === key && !["fait", "ignore"].includes(t.status));
    mine.forEach((t) => { t.source = "claude"; t.confidence = Math.min(0.97, +(t.confidence + 0.08).toFixed(2)); t.updated_at = new Date().toISOString(); });
    claudeCall(); log("✦ claude", "analyse d’un fil à la demande");
    return { ok: true, ids: mine.map((t) => t.id), message: mine.length ? `Claude a analysé le fil : ${mine.length} tâche${plural(mine.length, "", "s")} (simulation)` : "Claude : rien à faire dans ce fil" };
  }

  /* ----- Barre de commande : quelques demandes comprises, sinon une réponse d'aide ----- */
  function command(text) {
    const low = norm(text), c = ctx();
    const open = rows().filter((r) => VIEW.tout(r, c));
    const titles = (ids) => open.filter((r) => ids.includes(r.id)).map((r) => r.title).slice(0, 8);
    const filter = (ids, query, reply) => ({ reply, actions: [{ type: "filter", ids, query, titles: titles(ids) }] });
    const who = Object.entries(P).find(([k, p]) => k !== "me" && p.tu && new RegExp(`\\b${norm(p.name.split(" ")[0])}\\b`).test(low));
    if (who) {
      const [key, p] = who, ids = open.filter((r) => r._w === key).map((r) => r.id), first = p.name.split(" ")[0];
      if (!ids.length) return { reply: `Je ne vois aucune tâche ouverte liée à ${first}.`, actions: [] };
      if (/report|decale|repousse/.test(low)) {
        const target = /demain/.test(low) ? 1 : (() => { const names = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]; const w = names.findIndex((n) => low.includes(n)); return w < 0 ? 1 : ((w - new Date().getDay() + 7) % 7) || 7; })();
        const d = new Date(); d.setDate(d.getDate() + target);
        return { reply: `Je te propose de reporter les ${ids.length} tâches de ${first} au ${longDay(ymd(d))}, 9 h. Rien n’est modifié sans ta confirmation.`,
          actions: [{ type: "snooze", ids, until: `${ymd(d)}T09:00`, titles: titles(ids) }] };
      }
      if (/\b(fait|fini|termine|clos|solde)/.test(low))
        return { reply: `Je peux marquer comme faites les ${ids.length} tâches venant de ${first}. À toi de confirmer.`, actions: [{ type: "done", ids, titles: titles(ids) }] };
      return filter(ids, `De ${first}`, `Voici les ${ids.length} tâches liées à ${first}.`);
    }
    if (/retard/.test(low)) { const ids = open.filter((r) => VIEW.retard(r, c)).map((r) => r.id); return filter(ids, "En retard", `${ids.length} tâche${plural(ids.length, "", "s")} en retard, les plus anciennes d’abord.`); }
    if (/attente|relanc/.test(low)) { const ids = open.filter((r) => VIEW.en_attente(r, c)).map((r) => r.id); return filter(ids, "En attente", `Voici les ${ids.length} sujets où tu attends une réponse : ce sont tes relances à prévoir.`); }
    if (/securit|plugin|wordpress|faille|vulnerab/.test(low)) { const ids = open.filter((r) => r.lot === "Sécurité WordPress").map((r) => r.id); return filter(ids, "Sécurité WordPress", `${ids.length} tâches de sécurité WordPress, à traiter en série.`); }
    if (/urgent|prioritaire|haute|important/.test(low)) { const ids = open.filter((r) => r.priority === "haute").map((r) => r.id); return filter(ids, "Priorité haute", `${ids.length} tâches en priorité haute en ce moment.`); }
    if (/hostline|ticket|support/.test(low)) { const ids = open.filter((r) => r._w === "hostline" || r._w === "hostmon").map((r) => r.id); return filter(ids, "Hostline", `${ids.length} tâches liées à Hostline (tickets de support et alertes).`); }
    return { reply: "Mode démo : je réponds ici avec des réponses préparées. Essaie par exemple « qu’est-ce qui est en retard ? », « reporte ce qui vient de Léa à jeudi », « montre les tâches de sécurité WordPress » ou « sur quoi j’attends une réponse ? ». Dans la vraie application, la demande est comprise par l’IA locale ou par Claude.", actions: [] };
  }

  async function route(method, path, qs, body) {
    switch (`${method} ${path}`) {
      case "GET /state": return apiState();
      case "GET /tasks": return listTasks(qs.view || "focus", qs.q, qs.lot);
      case "GET /thread": return clone(MSGS[qs.key] || []);
      case "GET /folders": return folders();
      case "GET /usage": return USAGE.slice(0, 6).concat([usageToday()]);
      case "POST /task": { const { id, ...f } = body || {}; return update(id ? [id] : [], f); }
      case "POST /bulk": return update((body && body.ids) || [], (body && body.fields) || {}, body && body.note);
      case "POST /command": await sleep(600 + Math.random() * 400); return command(((body && body.text) || "").trim().slice(0, 500));
      case "POST /sync": return sync();
      case "POST /engine": await sleep(500); return { ok: true, message: "Claude connecté (simulation de la démo)" };
      case "POST /folders": ENGINE.excluded = new Set((body && body.excluded) || []); return { ok: true, threads: 0 };
      case "POST /reanalyze": return reanalyze(body && body.thread_key);
      case "POST /draft": return draft(body && body.id);
      case "POST /open": return { ok: false };
    }
    return null;
  }

  /* ===================== Interception de fetch : « /api/... » reste dans le navigateur ===================== */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    let u;
    try { u = new URL(url, location.href); } catch (e) { return realFetch(input, init); }
    const m = u.pathname.match(/\/api\/([a-z]+)$/);
    if (!m) return realFetch(input, init);
    const method = ((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    let body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    const qs = Object.fromEntries(u.searchParams.entries());
    const data = await route(method, "/" + m[1], qs, body);
    return new Response(JSON.stringify(data === null ? { error: "introuvable" } : data), {
      status: data === null ? 404 : 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  };

  // « Ouvrir dans Outlook » : pas de boîte mail en démo, on n'ouvre rien
  const realOpen = window.open ? window.open.bind(window) : null;
  window.open = function (url, ...rest) {
    if (/outlook\.office\.com/.test(String(url || ""))) {
      setTimeout(() => window.toast && window.toast("Démo : aucune boîte mail n’est connectée, rien à ouvrir"), 350);
      return null;
    }
    return realOpen ? realOpen(url, ...rest) : null;
  };

  /* ===================== Badge « Démo — données fictives » ===================== */
  function badge() {
    const css = document.createElement("style");
    css.textContent = `
      .demo-badge { position: fixed; right: 14px; bottom: 14px; z-index: 65; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 28px);
        padding: 6px 8px 6px 12px; border-radius: 999px; background: var(--card-solid); color: var(--muted); border: 1px solid var(--stroke);
        font: 500 11.5px/1.2 var(--font); box-shadow: 0 8px 24px rgba(0,0,0,.25); opacity: .92; }
      .demo-badge:hover { opacity: 1; }
      .demo-badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warn, #fbbf24); flex: none; }
      .demo-badge b { color: var(--fg); font-weight: 600; }
      .demo-badge a { color: var(--accent); text-decoration: none; }
      .demo-badge a:hover { text-decoration: underline; }
      .demo-badge button { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
      .demo-badge button:hover { background: var(--card-hi); color: var(--fg); }
      @media (max-width: 560px) { .demo-badge .more { display: none; } }`;
    document.head.appendChild(css);
    const el = document.createElement("div");
    el.className = "demo-badge";
    el.setAttribute("role", "note");
    el.innerHTML = `<span class="dot" aria-hidden="true"></span><span><b>Démo</b> — données fictives</span>` +
      (REPO_URL ? `<span class="more">· <a href="${REPO_URL}" target="_blank" rel="noopener">Code source</a></span>` : "") +
      `<button type="button" title="Réinitialiser la démo" aria-label="Réinitialiser la démo">↺</button>`;
    el.querySelector("button").onclick = () => {
      try { Object.keys(localStorage).filter((k) => k.startsWith("mp.steps.")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* stockage indisponible */ }
      location.reload();
    };
    document.body.appendChild(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", badge); else badge();
})();
