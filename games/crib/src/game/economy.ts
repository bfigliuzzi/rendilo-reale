/**
 * La bourse d'UN NIVEAU.
 *
 * Elle vit ici et pas ailleurs, et chacun des trois refus compte :
 *  - pas dans `World`, qui fait déjà six cents lignes ;
 *  - pas dans `Flow`, qui ne simule rien ;
 *  - surtout pas dans la SAUVEGARDE. L'absence de méta-progression est une
 *    décision de design, et le schéma de save est l'endroit où on la fait
 *    respecter : tant que l'or n'apparaît nulle part dans `SaveData`, aucun patch
 *    futur ne pourra le rendre persistant par inadvertance.
 *
 * `reset` est appelé par `loadLevel` — donc aussi par le ↻. L'or non dépensé se
 * reporte en revanche d'une nuit à l'autre, sans plafond ni intérêt : thésauriser
 * deux nuits pour sauter directement à une tour de niveau 3 est une stratégie
 * légitime, et c'est elle qui donne de la texture à la phase de jour.
 */
export class Economy {
  gold = 0;
  earnedTotal = 0;
  earnedThisNight = 0;
  spentTotal = 0;

  reset(start: number): void {
    this.gold = start;
    this.earnedTotal = 0;
    this.earnedThisNight = 0;
    this.spentTotal = 0;
  }

  beginNight(): void {
    this.earnedThisNight = 0;
  }

  credit(n: number): void {
    if (n <= 0) return;
    this.gold += n;
    this.earnedTotal += n;
    this.earnedThisNight += n;
  }

  can(n: number): boolean {
    return this.gold >= n;
  }

  /** `false` si insuffisant. AUCUN achat partiel : un demi-mur n'existe pas. */
  trySpend(n: number): boolean {
    if (this.gold < n) return false;
    this.gold -= n;
    this.spentTotal += n;
    return true;
  }
}
