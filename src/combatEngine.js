/**
 * Combat Engine for METALHEART.
 * Handles the turn-based state machine, combination logic, grimoire math, and interaction counter-play.
 */

export class CombatEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.playerHP = 10;
    this.opponentHP = 10;
    
    // Barriers: { type: 'CHROME' | 'MIRROR', turnsLeft: number }
    this.playerBarrier = null;
    this.opponentBarrier = null;
    
    // Statuses (DOTs/HOTs): { id: string, type: 'DECAY'|'PULSE'|'BLOOD'|'ECHO', turnsLeft: number, valPerTurn: number, isDebuff: boolean, name: string }
    this.playerStatuses = [];
    this.opponentStatuses = [];
    
    // Permanent armor buffers (reduced physical damage by 1)
    this.playerArmorBuffer = 0;
    this.opponentArmorBuffer = 0;

    // Visual screen overlay statuses (turns left)
    this.playerBlindTurns = 0;
    this.opponentBlindTurns = 0;
    this.playerSmokescreenTurns = 0;
    this.opponentSmokescreenTurns = 0;
    this.playerOvergrowthTurns = 0;
    this.opponentOvergrowthTurns = 0;
    this.playerSporeGridTurns = 0;
    this.opponentSporeGridTurns = 0;
    this.playerCharlesTotemTurns = 0;
    this.opponentCharlesTotemTurns = 0;

    // Blossom seeds count
    this.playerOvertimeBlossomCount = 0;
    this.opponentOvertimeBlossomCount = 0;

    // Charles selection cooldowns
    this.playerCharlesCooldown = 0;
    this.opponentCharlesCooldown = 0;

    // Cloud casting trackers for Lightning Effect fusions
    this.playerCastCloudLastTurn = false;
    this.opponentCastCloudLastTurn = false;

    // To prevent casting Void projectile twice in a row
    this.playerCastVoidLastTurn = false;
    this.opponentCastVoidLastTurn = false;
    this.playerForceSelfCastNextTurn = false;
    this.opponentForceSelfCastNextTurn = false;
    this.playerVoidSelfCastCooldown = 0;
    this.opponentVoidSelfCastCooldown = 0;

    // Echo states
    this.playerStallTurns = 0;
    this.opponentStallTurns = 0;
    this.playerHarmonicCleanseActive = false;
    this.opponentHarmonicCleanseActive = false;
    this.playerSonicAnvilActive = false;
    this.opponentSonicAnvilActive = false;
    this.playerEchoCooldown = 0;
    this.opponentEchoCooldown = 0;
    this.playerInternalResonanceTurns = 0;
    this.opponentInternalResonanceTurns = 0;

    this.logs = ["COMBAT ENGINE ONLINE. SELECT YOUR LOADOUT TO BEGIN."];
    this.turnNumber = 1;
  }

  /**
   * Evaluates what action a 3-element combo and target vector represent.
   * Evaluates elements as an UNORDERED SET (order-independent).
   * @param {Array<string>} combo - Array of elements (max 3)
   * @param {string} target - "SELF" or "PROJECTILE"
   * @returns {Object} Action object
   */
  evaluateCombo(combo, target) {
    if (!combo || combo.length === 0) {
      return {
        type: 'IDLE',
        name: 'Forfeit/Rest',
        archetype: 'PHYSICAL',
        damage: 0,
        heal: 0,
        description: 'Forfeits action phase or rests to gather kinetic energy.'
      };
    }

    // Unordered helper counts
    const count = (el) => combo.filter(x => x === el).length;

    const cloudCount = count('CLOUD');
    const bloodCount = count('BLOOD');
    const pulseCount = count('PULSE');
    const chromeCount = count('CHROME');
    const mirrorCount = count('MIRROR');
    const decayCount = count('DECAY');
    const voidCount = count('VOID');
    const lotusCount = count('LOTUS');
    const charlesCount = count('CHARLES');
    const echoCount = count('ECHO');

    // Illegal Pairs Check (Echo contradiction)
    if (echoCount > 0 && (voidCount > 0 || decayCount > 0 || mirrorCount > 0)) {
      return {
        type: 'IDLE',
        name: 'Combination Contradiction',
        archetype: 'PHYSICAL',
        damage: 0,
        heal: 0,
        description: 'ILLEGAL ECHO PAIRING DETECTED. Action fizzles.'
      };
    }

    // Echo Formulas:
    // Blood + Echo (Piercing Blood)
    if (echoCount > 0 && bloodCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Piercing Blood',
        archetype: 'SOUND',
        damage: 0,
        isInternalResonance: true,
        description: 'Target blocked from receiving or absorbing health chunks from any source for 2 turns.'
      };
    }

    // Chrome + Echo (Sonic Anvil self / Sonic Railgun projection)
    if (chromeCount > 0 && echoCount > 0) {
      if (target === 'SELF') {
        return {
          type: 'SELF_CAST',
          name: 'Sonic Anvil',
          archetype: 'SOUND',
          isSonicAnvil: true,
          description: 'Grants a 1-turn 1 HP shield. If struck by physical/pulse, deals 2 HP backlash to attacker (bypasses barriers).'
        };
      } else {
        return {
          type: 'PROJECTILE',
          name: 'Sonic Railgun',
          archetype: 'KINETIC',
          damage: 2, // lowered to 2 DMG per balance patch
          isSonicRailgun: true,
          description: 'Deals 2 Kinetic DMG. Punches through clouds. Shatters Mirror Barriers for 4 DMG. Recoils/stalls caster on Chrome Barrier.'
        };
      }
    }

    // Echo + Pulse (Delayed Strike)
    if (echoCount > 0 && pulseCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Delayed Strike',
        archetype: 'SOUND',
        damage: 0,
        isDelayedStrike: true,
        description: 'Deals 0 DMG and applies a 1-turn Echo resonance. Detonates on the next round for 4 DMG (6 DMG vs Chrome Barrier).'
      };
    }

    // Echo + Cloud (Thunderclap Cleanse)
    if (echoCount > 0 && cloudCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Thunderclap Cleanse',
        archetype: 'SOUND',
        damage: 0,
        isThunderclapCleanse: true,
        description: 'Dissipates cloud fields on impact (deals 0 DMG).'
      };
    }

    // Echo + Lotus (Harmonic Cleanse)
    if (echoCount > 0 && lotusCount > 0 && target === 'SELF') {
      return {
        type: 'SELF_CAST',
        name: 'Harmonic Cleanse',
        archetype: 'SOUND',
        isHarmonicCleanse: true,
        description: 'Grants 1-turn immunization from all DOT and poison ticks.'
      };
    }

    // Solo Echo Projectile (Echo Wave)
    if (echoCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Echo Wave',
        archetype: 'SOUND',
        damage: 2,
        isEchoWave: true,
        description: 'Deals 2 Sound DMG. Bypasses standard shields. Shatters Mirror Barriers for 1 piercing DMG. Deflects on Chrome Barriers.'
      };
    }

    // Solo Echo Self-Cast (Echo Cleanse)
    if (echoCount > 0 && target === 'SELF') {
      return {
        type: 'SELF_CAST',
        name: 'Echo Cleanse',
        archetype: 'SOUND',
        isEchoCleanse: true,
        description: 'Purges negative cloud, gas, and fog statuses from the caster.'
      };
    }

    // Lotus Formulas:
    // Lotus + Chrome (Physical Spiked Iron Rose)
    if (lotusCount > 0 && chromeCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Spiked Iron Rose',
        archetype: 'PHYSICAL',
        damage: 3,
        isSpikedRose: true,
        description: 'Deals 3 Physical DMG. Violently splinters on Chrome/Mirror Barriers, shattering them and dealing 1 piercing shrapnel DMG.'
      };
    }
    // Lotus + Pulse (Light Solar Bloom Laser)
    if (lotusCount > 0 && pulseCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Solar Bloom Laser',
        archetype: 'LIGHT',
        damage: 2,
        isSolarLaser: true,
        description: 'Deals 2 Light DMG. Bypasses Chrome Barriers; reflected fully by Mirror Barrier.'
      };
    }
    // Lotus + Blood (Physical Self Cast Overtime Blossom)
    if (lotusCount > 0 && bloodCount > 0 && target === 'SELF') {
      return {
        type: 'SELF_CAST',
        name: 'Overtime Blossom',
        archetype: 'PHYSICAL',
        heal: 0,
        isOvertimeBlossom: true,
        description: 'Seeds HP pool: restores +1 HP at the start of every round. 1 turn to germinate (0 heal this turn).'
      };
    }
    // Lotus + Cloud (Gas Spore Grid)
    if (lotusCount > 0 && cloudCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'The Spore Grid',
        archetype: 'GAS',
        damage: 0,
        isGas: true,
        isSporeGrid: true,
        duration: 2,
        description: 'Deploys a pink petal gas trap on opponent grid (2 turns). Physical Chrome shots detonate prematurely on them for 2 DMG.'
      };
    }
    // Lotus Standalone Projectile Bud
    if (lotusCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Lotus Bud',
        archetype: 'PHYSICAL',
        damage: 1,
        isLotusBud: true,
        description: 'Deals 1 Physical DMG. Applies Overgrowth status for 2 turns (locks Key 1 and Key 4).'
      };
    }
    // Lotus Standalone Self Blossom Focus
    if (lotusCount > 0 && target === 'SELF') {
      return {
        type: 'SELF_CAST',
        name: 'Blossom Focus',
        archetype: 'PHYSICAL',
        heal: 1,
        description: 'Restores 1 HP instantly.'
      };
    }

    // 2. VOID (Kinetic Denier & Beyond Void)
    if (voidCount > 0 && target === 'PROJECTILE') {
      if (pulseCount > 0) {
        return {
          type: 'PROJECTILE',
          name: 'Beyond Void',
          archetype: 'KINETIC',
          damage: 3,
          isBeyondVoid: true,
          isVoidAction: true, // Universal Void cooldown flag
          description: 'Fires an overpowered kinetic burst (3 Physical DMG). Heavy kinetic impact forces targets into SELF-CAST ONLY on their next turn.'
        };
      } else {
        return {
          type: 'PROJECTILE',
          name: 'Void Projectile',
          archetype: 'KINETIC',
          damage: 0,
          isVoid: true,
          isVoidAction: true, // Universal Void cooldown flag
          description: 'Fires a kinetic denier to destroy the enemy projectile (0 DMG, 3-turn cooldown).'
        };
      }
    }

    // 2. CLOUD SPELLS (Gas Carrier / Fusions)
    if (cloudCount > 0) {
      if (target === 'SELF') {
        if (bloodCount > 0) {
          // Cloud + Blood (Self): Healing Mist (+2 HP/turn for 3 turns)
          return {
            type: 'SELF_CAST',
            name: 'Healing Mist',
            archetype: 'GAS',
            heal: 2,
            duration: 3,
            isGas: true,
            description: 'Creates a soothing crimson mist, restoring +2 HP per turn for 3 turns (6 HP total).'
          };
        } else {
          // Raw Cloud (Self): Purges Gas status + sets up smokescreen for 3 turns
          return {
            type: 'SELF_CAST',
            name: 'Cloud Smokescreen & Purge',
            archetype: 'GAS',
            isGas: true,
            isPurge: true,
            isSmokescreen: true,
            duration: 3,
            description: 'Purges active gas DOTs and floods your right-hand screen space with dense gray vapor for 3 turns.'
          };
        }
      } else { // PROJECTILE Gas fusions
        if (decayCount > 0) {
          // Cloud + Decay: 2 DMG/turn for 2 turns (4 DMG total)
          return {
            type: 'PROJECTILE',
            name: 'Decay Gas',
            archetype: 'GAS',
            damage: 2,
            duration: 2,
            isGas: true,
            description: 'Launches a toxic bio-cloud, dealing 2 DMG per turn for 2 turns (4 DMG total).'
          };
        } else if (pulseCount > 0) {
          // Cloud + Pulse: 4 DMG AOE (1 turn)
          return {
            type: 'PROJECTILE',
            name: 'Lightning Storm Gas',
            archetype: 'GAS',
            damage: 4,
            duration: 1,
            isGas: true,
            isAOE: true,
            description: 'Redesigned AOE: Deals 4 DMG to the enemy on impact.'
          };
        } else {
          // Raw Cloud Projectile: 0 DMG, bypasses shields, visual smokescreen, inflicts Fog
          return {
            type: 'PROJECTILE',
            name: 'Fog Shard',
            archetype: 'GAS',
            damage: 0,
            duration: 3,
            isGas: true,
            description: 'Fires a dense gray smokescreen vapor (0 DMG, bypasses barriers, inflicts Fog for 3 turns).'
          };
        }
      }
    }

    // 3. THREE-OF-A-KIND PURE STACKS
    // Pulse + Pulse + Pulse
    if (pulseCount === 3 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Hyper-Pulse Beam',
        archetype: 'LIGHT',
        damage: 3,
        description: 'Triggers an overpowered light strike, dealing 3 Light DMG.'
      };
    }
    // Chrome + Chrome + Chrome
    if (chromeCount === 3 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Ironclad Golem Strike',
        archetype: 'PHYSICAL',
        damage: 3,
        isArmorBuff: true,
        description: 'Fires a heavy block dealing 3 Physical DMG + grants a permanent 1-point armor buffer.'
      };
    }
    // Blood + Blood + Blood (Self Cast)
    if (bloodCount === 3 && target === 'SELF') {
      return {
        type: 'SELF_CAST',
        name: 'Sanguine Resurgence',
        archetype: 'PHYSICAL',
        heal: 3,
        description: 'Instantly restores 3 HP to your health pool.'
      };
    }

    // 4. MIRROR + BLOOD PROJECTILE FUSION
    if (mirrorCount > 0 && bloodCount > 0 && target === 'PROJECTILE') {
      return {
        type: 'PROJECTILE',
        name: 'Blood-Glass Prism Shards',
        archetype: 'PHYSICAL',
        damage: combo.length, // Deals damage multiplied by slot count (1 per slot)
        lifesteal: true,
        description: `Fires blood-infused glass shards (Deals ${combo.length} Physical DMG) with 100% Lifesteal.`
      };
    }

    // 5. STANDARD SELF CASTS
    if (target === 'SELF') {
      if (chromeCount > 0) {
        return {
          type: 'SELF_CAST',
          name: 'Chrome Barrier',
          archetype: 'PHYSICAL',
          isBarrier: 'CHROME',
          duration: 2,
          description: 'Generates a silver barrier lasting 2 turns. Absorbs 100% of Physical damage. Bypassed by Light & Gas.'
        };
      }
      if (mirrorCount > 0) {
        return {
          type: 'SELF_CAST',
          name: 'Mirror Barrier',
          archetype: 'PHYSICAL',
          isBarrier: 'MIRROR',
          duration: 2,
          description: 'Generates a blue prism barrier lasting 2 turns. Reflects 100% of Light damage. Shattered by Physical & Gas.'
        };
      }
      if (bloodCount > 0) {
        return {
          type: 'SELF_CAST',
          name: 'Crimson Infusion',
          archetype: 'PHYSICAL',
          heal: 1,
          description: 'Restores 1 HP instantly.'
        };
      }
      if (decayCount > 0) {
        return {
          type: 'SELF_CAST',
          name: 'Decay Neutralizer',
          archetype: 'PHYSICAL',
          description: 'Cleanses active decay status and prevents its tick damage this turn.'
        };
      }
      if (voidCount > 0) {
        return {
          type: 'SELF_CAST',
          name: 'Void Shelter',
          archetype: 'KINETIC',
          isVoidSelfCast: true,
          isVoidAction: true, // Universal Void cooldown flag
          description: 'Immediately purges active Decay, Cloud, and Lotus debuffs. Grants complete invulnerability this turn.'
        };
      }
      return {
        type: 'SELF_CAST',
        name: 'Posture Charge',
        archetype: 'PHYSICAL',
        description: 'Charges internal focus (visual charging static).'
      };
    }

    // 6. STANDARD SINGLE/DOUBLE ELEMENT PROJECTILES
    if (target === 'PROJECTILE') {
      if (pulseCount > 0) {
        return {
          type: 'PROJECTILE',
          name: 'Pulse Bolt',
          archetype: 'LIGHT',
          damage: 2,
          description: 'Deals 2 Light DMG. Blocked by Chrome Barriers. Reflected by Mirror.'
        };
      }
      if (chromeCount > 0) {
        return {
          type: 'PROJECTILE',
          name: 'Chrome Rock',
          archetype: 'PHYSICAL',
          damage: 2,
          description: 'Launches a liquid-metal chrome boulder dealing 2 Physical DMG.'
        };
      }
      if (mirrorCount > 0) {
        return {
          type: 'PROJECTILE',
          name: 'Mirror Shard',
          archetype: 'PHYSICAL',
          damage: 1,
          description: 'Launches mirror shards dealing 1 Physical DMG.'
        };
      }
      if (bloodCount > 0) {
        return {
          type: 'PROJECTILE',
          name: 'Blood Dart',
          archetype: 'PHYSICAL',
          damage: 1,
          lifesteal: true,
          description: 'Launches coagulated blood spike dealing 1 Physical DMG with 100% Lifesteal.'
        };
      }
      if (decayCount > 0) {
        return {
          type: 'PROJECTILE',
          name: 'Decay Strike',
          archetype: 'PHYSICAL',
          damage: 2,
          isCorrosive: true,
          duration: 1,
          description: 'Deals 2 Physical DMG on impact, and adds a 2 DMG decay tick for the following turn.'
        };
      }
      
      // Default
      return {
        type: target === 'SELF' ? 'SELF_CAST' : 'PROJECTILE',
        name: target === 'SELF' ? 'Wasted Focus' : 'Force Bolt',
        archetype: 'PHYSICAL',
        damage: target === 'SELF' ? 0 : 1,
        heal: 0,
        description: target === 'SELF' ? 'A mistimed self-cast fizzles harmlessly.' : 'Launches an unrefined force bolt dealing 1 Physical DMG.'
      };
    }
  }

  /**
   * Generates a tactical combat combination for the opponent AI.
   * Opponent loadout is fixed/locked as [VOID, BLOOD, CHROME, MIRROR] or similar.
   * @returns {Object} { combo: Array, target: string }
   */
  generateOpponentAction() {
    const choices = [
      { combo: ['PULSE'], target: 'PROJECTILE' },
      { combo: ['CHROME'], target: 'SELF' },
      { combo: ['MIRROR'], target: 'SELF' },
      { combo: ['CLOUD', 'DECAY'], target: 'PROJECTILE' },
      { combo: ['MIRROR', 'BLOOD'], target: 'PROJECTILE' },
      { combo: ['CHROME'], target: 'PROJECTILE' }
    ];

    // AI Echo rules: cannot cast Echo if on cooldown
    if (this.opponentEchoCooldown <= 0) {
      choices.push(
        { combo: ['ECHO'], target: 'PROJECTILE' },
        { combo: ['CHROME', 'ECHO'], target: 'PROJECTILE' },
        { combo: ['ECHO', 'CLOUD'], target: 'PROJECTILE' }
      );
    }

    // AI Void rules: cannot cast void twice in a row!
    if (!this.opponentCastVoidLastTurn && this.opponentVoidSelfCastCooldown <= 0) {
      choices.push({ combo: ['VOID'], target: 'PROJECTILE' });
    }

    if (this.opponentHP <= 4) {
      choices.push(
        { combo: ['CLOUD', 'BLOOD'], target: 'SELF' },
        { combo: ['BLOOD', 'BLOOD', 'BLOOD'], target: 'SELF' },
        { combo: ['CHROME'], target: 'SELF' }
      );
    }

    const idx = Math.floor(Math.random() * choices.length);
    return choices[idx];
  }

  /**
   * Resolves turn math. Called after projectile visuals finish.
   * @param {Array<string>} playerCombo - Local Player's combo
   * @param {string} playerTarget - "SELF" or "PROJECTILE"
   * @param {Object} networkOpponentAction - Incoming action from PeerJS { combo, target }
   * @returns {Object} Report logs and action results
   */
  resolveTurn(playerCombo, playerTarget, pregeneratedOpponentAction = null) {
    const logs = [];
    logs.push(`--- ROUND ${this.turnNumber} ---`);

    const oppActionData = pregeneratedOpponentAction || this.generateOpponentAction();

    // Reset temporary flags at the start of the round resolution
    this.playerHarmonicCleanseActive = false;
    this.opponentHarmonicCleanseActive = false;
    this.playerSonicAnvilActive = false;
    this.opponentSonicAnvilActive = false;

    // Tick down internal resonance
    if (this.playerInternalResonanceTurns > 0) this.playerInternalResonanceTurns--;
    if (this.opponentInternalResonanceTurns > 0) this.opponentInternalResonanceTurns--;

    // Stall Recoil Checks: If stalled, action is forced to IDLE
    if (this.playerStallTurns > 0) {
      playerCombo = [];
      playerTarget = 'SELF';
      this.playerStallTurns--;
      logs.push(`>> PLAYER is STALLED and cannot act this turn!`);
    }
    if (this.opponentStallTurns > 0) {
      oppActionData.combo = [];
      oppActionData.target = 'SELF';
      this.opponentStallTurns--;
      logs.push(`>> OPPONENT is STALLED and cannot act this turn!`);
    }
    
    // Evaluate both combos
    const pAction = this.evaluateCombo(playerCombo, playerTarget);
    const oAction = this.evaluateCombo(oppActionData.combo, oppActionData.target);

    // Universal Void cooldown check — blocks ALL Void actions (Shelter, Projectile, Beyond Void)
    if (pAction.isVoidAction && this.playerVoidSelfCastCooldown > 0) {
      logs.push(`>> PLAYER's ${pAction.name} fails! (Void on cooldown for ${this.playerVoidSelfCastCooldown} more turns).`);
      pAction.type = 'IDLE';
      pAction.name = 'Void Cooldown Fizzle';
      pAction.isVoidSelfCast = false;
      pAction.isVoidAction = false;
      pAction.isVoid = false;
      pAction.isBeyondVoid = false;
      pAction.damage = 0;
    }
    if (oAction.isVoidAction && this.opponentVoidSelfCastCooldown > 0) {
      logs.push(`>> OPPONENT's ${oAction.name} fails! (Void on cooldown for ${this.opponentVoidSelfCastCooldown} more turns).`);
      oAction.type = 'IDLE';
      oAction.name = 'Void Cooldown Fizzle';
      oAction.isVoidSelfCast = false;
      oAction.isVoidAction = false;
      oAction.isVoid = false;
      oAction.isBeyondVoid = false;
      oAction.damage = 0;
    }

    // Charles cooldown check
    if (pAction.isCharles && this.playerCharlesCooldown > 0) {
      logs.push(`>> PLAYER's Charles Totem fails! (Charles on cooldown for ${this.playerCharlesCooldown} more turns).`);
      pAction.type = 'IDLE';
      pAction.name = 'Charles Cooldown Fizzle';
      pAction.isCharles = false;
    }
    if (oAction.isCharles && this.opponentCharlesCooldown > 0) {
      logs.push(`>> OPPONENT's Charles Totem fails! (Charles on cooldown for ${this.opponentCharlesCooldown} more turns).`);
      oAction.type = 'IDLE';
      oAction.name = 'Charles Cooldown Fizzle';
      oAction.isCharles = false;
    }

    // Echo 1-turn cooldown check (blocks ANY Echo action if on cooldown)
    const pHasEcho = playerCombo && playerCombo.includes('ECHO');
    const oHasEcho = oppActionData && oppActionData.combo && oppActionData.combo.includes('ECHO');

    if (pHasEcho && this.playerEchoCooldown > 0) {
      logs.push(`>> PLAYER's Echo action fails! (Echo on cooldown for 1 more turn).`);
      pAction.type = 'IDLE';
      pAction.name = 'Echo Cooldown Fizzle';
      pAction.damage = 0;
      pAction.heal = 0;
      pAction.isEchoWave = false;
      pAction.isEchoCleanse = false;
      pAction.isDelayedStrike = false;
      pAction.isInternalResonance = false;
      pAction.isSonicAnvil = false;
      pAction.isSonicRailgun = false;
      pAction.isThunderclapCleanse = false;
      pAction.isHarmonicCleanse = false;
    }
    if (oHasEcho && this.opponentEchoCooldown > 0) {
      logs.push(`>> OPPONENT's Echo action fails! (Echo on cooldown for 1 more turn).`);
      oAction.type = 'IDLE';
      oAction.name = 'Echo Cooldown Fizzle';
      oAction.damage = 0;
      oAction.heal = 0;
      oAction.isEchoWave = false;
      oAction.isEchoCleanse = false;
      oAction.isDelayedStrike = false;
      oAction.isInternalResonance = false;
      oAction.isSonicAnvil = false;
      oAction.isSonicRailgun = false;
      oAction.isThunderclapCleanse = false;
      oAction.isHarmonicCleanse = false;
    }

    // Set invulnerability and purge status effects if Void self-cast executes
    let playerInvulnerable = false;
    let opponentInvulnerable = false;

    if (pAction.isVoidSelfCast) {
      playerInvulnerable = true;
      this.playerStatuses = [];
      this.playerOvergrowthTurns = 0;
      this.playerSporeGridTurns = 0;
      this.playerSmokescreenTurns = 0;
      this.playerBlindTurns = 0;
      this.playerCharlesTotemTurns = 0;
      this.playerOvertimeBlossomCount = 0;
      logs.push(`+ Player's Void Shelter purges all active status effects (Decay, Cloud, Lotus, and Charles) and grants complete invulnerability!`);
    }

    if (oAction.isVoidSelfCast) {
      opponentInvulnerable = true;
      this.opponentStatuses = [];
      this.opponentOvergrowthTurns = 0;
      this.opponentSporeGridTurns = 0;
      this.opponentSmokescreenTurns = 0;
      this.opponentBlindTurns = 0;
      this.opponentCharlesTotemTurns = 0;
      this.opponentOvertimeBlossomCount = 0;
      logs.push(`+ Opponent's Void Shelter purges all active status effects (Decay, Cloud, Lotus, and Charles) and grants complete invulnerability!`);
    }

    // Universal Void cooldown trigger — ANY successful Void action starts the 3-turn lock
    if (pAction.isVoidAction) {
      this.playerVoidSelfCastCooldown = 3;
      logs.push(`> Player's Void cooldown engaged (locked for 3 turns).`);
    }
    if (oAction.isVoidAction) {
      this.opponentVoidSelfCastCooldown = 3;
      logs.push(`> Opponent's Void cooldown engaged (locked for 3 turns).`);
    }

    // Echo 1-turn cooldown trigger
    if (pHasEcho && this.playerEchoCooldown === 0 && pAction.name !== 'Combination Contradiction') {
      this.playerEchoCooldown = 2; // Locked for 1 full turn (2 -> decrements to 1 at end of turn, 1 on next turn lockout)
      logs.push(`> Player's Echo cooldown engaged (locked for 1 turn).`);
    }
    if (oHasEcho && this.opponentEchoCooldown === 0 && oAction.name !== 'Combination Contradiction') {
      this.opponentEchoCooldown = 2;
      logs.push(`> Opponent's Echo cooldown engaged (locked for 1 turn).`);
    }

    // Spore Grid field traps triggers: detonates Chrome physical projectile prematurely
    if (this.playerSporeGridTurns > 0 && playerCombo.includes('CHROME') && playerTarget === 'PROJECTILE') {
      logs.push(`[TRAP] Player's Chrome projectile triggers the Spore Grid trap and detonates prematurely! (Player takes 2 DMG)`);
      this.playerHP -= 2;
      pAction.type = 'IDLE';
      pAction.name = 'Spore Detonation';
      pAction.damage = 0;
    }
    if (this.opponentSporeGridTurns > 0 && oppActionData.combo.includes('CHROME') && oppActionData.target === 'PROJECTILE') {
      logs.push(`[TRAP] Opponent's Chrome projectile triggers the Spore Grid trap and detonates prematurely! (Opponent takes 2 DMG)`);
      this.opponentHP -= 2;
      oAction.type = 'IDLE';
      oAction.name = 'Spore Detonation';
      oAction.damage = 0;
    }

    // Double check Void double-cast constraint
    if ((pAction.isVoid || pAction.isBeyondVoid) && this.playerCastVoidLastTurn) {
      logs.push(`>> PLAYER's VOID fails! (Cannot cast Void due to cooldown).`);
      pAction.type = 'IDLE';
      pAction.name = 'Void Fizzle';
      pAction.damage = 0;
      pAction.isVoid = false;
      pAction.isBeyondVoid = false;
    }
    if ((oAction.isVoid || oAction.isBeyondVoid) && this.opponentCastVoidLastTurn) {
      logs.push(`>> OPPONENT's VOID fails! (Cannot cast Void due to cooldown).`);
      oAction.type = 'IDLE';
      oAction.name = 'Void Fizzle';
      oAction.damage = 0;
      oAction.isVoid = false;
      oAction.isBeyondVoid = false;
    }

    logs.push(`PLAYER casts [${pAction.name}] targeting ${playerTarget}.`);
    logs.push(`OPPONENT casts [${oAction.name}] targeting ${oppActionData.target}.`);

    // PRE-CLEANSE DECAY: self-casting Decay while under active Decay status cleanses it
    const hasPlayerDecay = this.playerStatuses.some(s => s.type === 'DECAY');
    if (playerTarget === 'SELF' && playerCombo.includes('DECAY') && hasPlayerDecay) {
      this.playerStatuses = this.playerStatuses.filter(s => s.type !== 'DECAY');
      logs.push(`[CLEANSE] Player self-casts DECAY, neutralizing and cleansing the active decay status!`);
    }

    const hasOpponentDecay = this.opponentStatuses.some(s => s.type === 'DECAY');
    if (oppActionData.target === 'SELF' && oppActionData.combo.includes('DECAY') && hasOpponentDecay) {
      this.opponentStatuses = this.opponentStatuses.filter(s => s.type !== 'DECAY');
      logs.push(`[CLEANSE] Opponent self-casts DECAY, neutralizing and cleansing the active decay status!`);
    }

    // A. Resolve VOID Intercepts (Kinetic Denier)
    let pProjCancelled = false;
    let oProjCancelled = false;

    if (pAction.isVoid || pAction.isBeyondVoid) {
      this.playerCastVoidLastTurn = true;
      if (pAction.isBeyondVoid) {
        logs.push(`>> PLAYER unleashes BEYOND VOID!`);
      }
      
      if (oAction.type === 'PROJECTILE') {
        oProjCancelled = true;
        logs.push(`>> PLAYER's VOID intercepts and dissolves OPPONENT's [${oAction.name}]!`);
      } else {
        logs.push(`>> PLAYER's VOID flashes defensively, but nothing was fired.`);
      }

      // Void Disruption Gate for Charles Totem
      if (this.opponentCharlesTotemTurns > 0) {
        this.opponentCharlesTotemTurns = 0;
        logs.push(`>> PLAYER's VOID disruption wave instantly erases Opponent's Charles Totem!`);
      }
    } else {
      this.playerCastVoidLastTurn = false;
      this.playerForceSelfCastNextTurn = false;
    }

    if (oAction.isVoid || oAction.isBeyondVoid) {
      this.opponentCastVoidLastTurn = true;
      if (oAction.isBeyondVoid) {
        logs.push(`>> OPPONENT unleashes BEYOND VOID!`);
      }
      
      if (pAction.type === 'PROJECTILE') {
        pProjCancelled = true;
        logs.push(`>> OPPONENT's VOID intercepts and dissolves PLAYER's [${pAction.name}]!`);
      } else {
        logs.push(`>> OPPONENT's VOID flashes defensively, but nothing was fired.`);
      }

      // Void Disruption Gate for Charles Totem
      if (this.playerCharlesTotemTurns > 0) {
        this.playerCharlesTotemTurns = 0;
        logs.push(`>> OPPONENT's VOID disruption wave instantly erases Player's Charles Totem!`);
      }
    } else {
      this.opponentCastVoidLastTurn = false;
      this.opponentForceSelfCastNextTurn = false;
    }

    // B. Resolve SELF-CAST Spells (Barriers, heals, cleanses, smokescreens)
    // PLAYER Self Casts
    if (pAction.type === 'SELF_CAST' && !pProjCancelled) {
      if (pAction.isBarrier) {
        this.playerBarrier = { type: pAction.isBarrier, turnsLeft: pAction.duration };
        logs.push(`+ Player deploys ${pAction.isBarrier} BARRIER (2 turns).`);
      }
      if (pAction.isSonicAnvil) {
        this.playerSonicAnvilActive = true;
        logs.push(`+ Player activates Sonic Anvil! (1-turn shield, 2 HP backlash to attackers).`);
      }
      if (pAction.isHarmonicCleanse) {
        this.playerHarmonicCleanseActive = true;
        logs.push(`+ Player activates Harmonic Cleanse! (Immunity to DOT/poison ticks this turn).`);
      }
      if (pAction.isEchoCleanse) {
        this.playerStatuses = this.playerStatuses.filter(s => s.type !== 'DECAY' && s.type !== 'CLOUD');
        this.playerSmokescreenTurns = 0;
        this.playerBlindTurns = 0;
        logs.push(`+ Player's Echo Cleanse purges all active cloud, gas, and fog statuses.`);
      }
      if (pAction.heal && !pAction.isGas) {
        if (this.playerInternalResonanceTurns > 0) {
          logs.push(`[RESONANCE] Player's healing is blocked by Piercing Blood!`);
        } else if (this.playerCharlesTotemTurns > 0) {
          this.playerHP -= pAction.heal;
          logs.push(`[INVERSION] Charles Totem inverts healing! Player takes ${pAction.heal} DMG instead.`);
        } else {
          this.playerHP = Math.min(10, this.playerHP + pAction.heal);
          logs.push(`+ Player restores +${pAction.heal} HP.`);
        }
      }
      if (pAction.isPurge) {
        const oldLen = this.playerStatuses.length;
        this.playerStatuses = this.playerStatuses.filter(s => !s.isDebuff);
        if (this.playerStatuses.length < oldLen) {
          logs.push(`+ Player's CLOUD cleanses all active toxic gas anomalies.`);
        }
      }
      if (pAction.isSmokescreen) {
        this.playerSmokescreenTurns = pAction.duration;
        logs.push(`+ Player sets up a dense gray SMOKESCREEN vapor on the right (${pAction.duration} turns).`);
      }
      if (pAction.isGas && pAction.duration && pAction.name === 'Healing Mist') {
        this.playerStatuses = this.playerStatuses.filter(s => s.id !== 'healing_mist');
        this.playerStatuses.push({
          id: 'healing_mist',
          type: 'BLOOD',
          turnsLeft: pAction.duration,
          valPerTurn: Number(pAction.heal) || 0,
          isDebuff: false,
          name: 'Healing Mist'
        });
        logs.push(`+ Player is surrounded by Healing Mist (+2 HP/turn).`);
      }
      if (pAction.isOvertimeBlossom) {
        this.playerStatuses = this.playerStatuses.filter(s => s.id !== 'overtime_blossom');
        this.playerStatuses.push({
          id: 'overtime_blossom',
          type: 'BLOOD',
          turnsLeft: 5,
          valPerTurn: 1,
          isDebuff: false,
          name: 'Overtime Blossom'
        });
        logs.push(`+ Player seeds their health pool with Overtime Blossom! (+1 HP/round for 5 turns, does not stack)`);
      }
    }

    // OPPONENT Self Casts
    if (oAction.type === 'SELF_CAST' && !oProjCancelled) {
      if (oAction.isBarrier) {
        this.opponentBarrier = { type: oAction.isBarrier, turnsLeft: oAction.duration };
        logs.push(`+ Opponent deploys ${oAction.isBarrier} BARRIER (2 turns).`);
      }
      if (oAction.isSonicAnvil) {
        this.opponentSonicAnvilActive = true;
        logs.push(`+ Opponent activates Sonic Anvil! (1-turn shield, 2 HP backlash to attackers).`);
      }
      if (oAction.isHarmonicCleanse) {
        this.opponentHarmonicCleanseActive = true;
        logs.push(`+ Opponent activates Harmonic Cleanse! (Immunity to DOT/poison ticks this turn).`);
      }
      if (oAction.isEchoCleanse) {
        this.opponentStatuses = this.opponentStatuses.filter(s => s.type !== 'DECAY' && s.type !== 'CLOUD');
        this.opponentSmokescreenTurns = 0;
        this.opponentBlindTurns = 0;
        logs.push(`+ Opponent's Echo Cleanse purges all active cloud, gas, and fog statuses.`);
      }
      if (oAction.heal && !oAction.isGas) {
        if (this.opponentInternalResonanceTurns > 0) {
          logs.push(`[RESONANCE] Opponent's healing is blocked by Piercing Blood!`);
        } else if (this.opponentCharlesTotemTurns > 0) {
          this.opponentHP -= oAction.heal;
          logs.push(`[INVERSION] Charles Totem inverts healing! Opponent takes ${oAction.heal} DMG instead.`);
        } else {
          this.opponentHP = Math.min(10, this.opponentHP + oAction.heal);
          logs.push(`+ Opponent restores +${oAction.heal} HP.`);
        }
      }
      if (oAction.isPurge) {
        const oldLen = this.opponentStatuses.length;
        this.opponentStatuses = this.opponentStatuses.filter(s => !s.isDebuff);
        if (this.opponentStatuses.length < oldLen) {
          logs.push(`+ Opponent's CLOUD cleanses all active toxic gas anomalies.`);
        }
      }
      if (oAction.isSmokescreen) {
        this.opponentSmokescreenTurns = oAction.duration;
        logs.push(`+ Opponent sets up a dense gray SMOKESCREEN vapor (${oAction.duration} turns).`);
      }
      if (oAction.isGas && oAction.duration && oAction.name === 'Healing Mist') {
        this.opponentStatuses = this.opponentStatuses.filter(s => s.id !== 'healing_mist');
        this.opponentStatuses.push({
          id: 'healing_mist',
          type: 'BLOOD',
          turnsLeft: oAction.duration,
          valPerTurn: Number(oAction.heal) || 0,
          isDebuff: false,
          name: 'Healing Mist'
        });
        logs.push(`+ Opponent is surrounded by Healing Mist (+2 HP/turn).`);
      }
      if (oAction.isOvertimeBlossom) {
        this.opponentStatuses = this.opponentStatuses.filter(s => s.id !== 'overtime_blossom');
        this.opponentStatuses.push({
          id: 'overtime_blossom',
          type: 'BLOOD',
          turnsLeft: 5,
          valPerTurn: 1,
          isDebuff: false,
          name: 'Overtime Blossom'
        });
        logs.push(`+ Opponent seeds their health pool with Overtime Blossom! (+1 HP/round for 5 turns, does not stack)`);
      }
    }

    // C. Resolve PROJECTILES (Damage, barriers, reflect, etc.)
    let playerBacklash = 0;
    let opponentBacklash = 0;

    // A. Player Projectile hitting Opponent
    if (pAction.type === 'PROJECTILE' && !pProjCancelled) {
      if (pAction.isDelayedStrike) {
        if (opponentInvulnerable) {
          logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! Delayed Strike is negated.`);
        } else if (this.opponentBarrier && this.opponentBarrier.type === 'MIRROR') {
          this.opponentBarrier = null;
          logs.push(`[SHATTER] Player's Delayed Strike shatters Opponent's Mirror Barrier and is neutralized!`);
        } else {
          this.opponentStatuses.push({
            id: 'delayed_strike',
            type: 'ECHO',
            turnsLeft: 2, // Set to 2 turns so it does 0 damage this turn and detonates next turn
            valPerTurn: 0,
            isDebuff: true,
            name: 'Delayed Strike'
          });
          logs.push(`* Player applies Delayed Strike to Opponent! Resonance overlay active.`);
        }
      } else if (pAction.isInternalResonance) {
        if (opponentInvulnerable) {
          logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! Piercing Blood is negated.`);
        } else {
          this.opponentInternalResonanceTurns = 2;
          logs.push(`* Player inflicts Piercing Blood on Opponent (2 turns)!`);
        }
      } else if (pAction.isThunderclapCleanse) {
        this.opponentStatuses = this.opponentStatuses.filter(s => s.type !== 'DECAY' && s.type !== 'CLOUD');
        this.opponentSmokescreenTurns = 0;
        this.opponentBlindTurns = 0;
        logs.push(`[CLEANSE] Player's Thunderclap Cleanse dissipates all cloud fields and gas effects on Opponent.`);
      } else if (pAction.isGas && pAction.duration) {
        if (pAction.isSporeGrid) {
          if (opponentInvulnerable) {
            logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! Spore Grid trap is negated.`);
          } else {
            this.opponentSporeGridTurns = 2;
            logs.push(`* Player deploys a pink Spore Grid trap on Opponent's zone (2 turns).`);
          }
        } else if (pAction.isAOE) {
          if (opponentInvulnerable) {
            logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! Opponent takes 0 DMG.`);
          } else {
            this.opponentHP -= 4;
          }
          logs.push(`* Player's Lightning Storm Gas detonates! Opponent takes ${opponentInvulnerable ? 0 : 4} DMG.`);
        } else {
          if (opponentInvulnerable) {
            logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! [${pAction.name}] is negated.`);
          } else {
            // Apply DOT to opponent
            this.opponentStatuses.push({
              id: pAction.name === 'Decay Gas' ? 'decay_gas' : (pAction.name === 'Fog Shard' ? 'fog' : 'lightning_gas'),
              type: pAction.name === 'Decay Gas' ? 'DECAY' : (pAction.name === 'Fog Shard' ? 'CLOUD' : 'PULSE'),
              turnsLeft: pAction.duration,
              valPerTurn: Number(pAction.damage) || 0,
              isDebuff: true,
              name: pAction.name === 'Fog Shard' ? 'Fog' : pAction.name
            });
            if (pAction.name === 'Fog Shard') {
              logs.push(`* Player envelops Opponent in a thick [Fog] (3 turns).`);
            } else {
              logs.push(`* Player traps Opponent in a corrosive [${pAction.name}] (2 turns).`);
            }
          }
        }
      } else {
        // Direct projectile strike
        let rawDmg = pAction.damage || 0;
        if (pAction.name === 'Pulse Bolt') {
          const opponentHasHealingMist = this.opponentStatuses.some(s => s.name === 'Healing Mist' || s.id === 'healing_mist');
          const opponentHasGas = this.opponentStatuses.some(s => s.name === 'Decay Gas' || s.name === 'Fog' || s.name === 'Lightning Storm Gas' || s.id === 'decay_gas' || s.id === 'fog' || s.id === 'lightning_gas');
          
          if (opponentHasHealingMist) {
            pAction.name = 'Lightning Strike';
            rawDmg = 4;
            // Clear healing mist
            this.opponentStatuses = this.opponentStatuses.filter(s => s.name !== 'Healing Mist' && s.id !== 'healing_mist');
            logs.push(`[LIGHTNING STRIKE] Player's Pulse electrifies Opponent's Healing Mist! Healing is nullified and Opponent takes 4 Electrical DMG.`);
          } else if (opponentHasGas) {
            pAction.name = 'Lightning Storm';
            rawDmg = 4;
            logs.push(`[LIGHTNING STORM] Player's Pulse electrifies the lingering gas, triggering a Lightning Storm! (Deals 4 DMG)`);
          }
        }
        let finalDmg = rawDmg;
        let reflected = false;

        // Apply stacks bonuses
        if (pAction.isArmorBuff) {
          this.playerArmorBuffer++;
          logs.push(`* Player gains a permanent 1-point armor buffer.`);
        }

        // Spiked Iron Rose shatters barriers
        if (pAction.isSpikedRose) {
          if (this.opponentBarrier) {
            logs.push(`[SHATTER] Spiked Iron Rose splinters on impact, shattering Opponent's ${this.opponentBarrier.type} Barrier!`);
            this.opponentBarrier = null;
            finalDmg = 1;
          } else {
            finalDmg = 3;
          }
        } else if (pAction.isSonicRailgun) {
          if (this.opponentBarrier) {
            if (this.opponentBarrier.type === 'MIRROR') {
              this.opponentBarrier = null;
              finalDmg = 4;
              logs.push(`[SHATTER] Sonic Railgun shatters Opponent's Mirror Barrier! (Deals 4 DMG)`);
            } else if (this.opponentBarrier.type === 'CHROME') {
              finalDmg = 0;
              this.playerStallTurns = 1;
              logs.push(`[RECOIL] Sonic Railgun impacts Chrome Barrier! Player is recoiled/stalled for 1 turn, defender takes 0 DMG.`);
            }
          } else {
            finalDmg = 2; // lowered to 2 DMG per balance patch
          }
        } else if (pAction.isEchoWave) {
          if (this.opponentBarrier) {
            if (this.opponentBarrier.type === 'MIRROR') {
              this.opponentBarrier = null;
              finalDmg = 1;
              logs.push(`[SHATTER] Echo Wave shatters Opponent's Mirror Barrier! (Deals 1 piercing DMG)`);
            } else if (this.opponentBarrier.type === 'CHROME') {
              finalDmg = 0;
              playerBacklash += 3;
              logs.push(`[DEFLECT] Echo Wave deflects on Opponent's Chrome Barrier! Player takes 3 HP Reflected DMG, opponent takes 0.`);
            }
          } else {
            finalDmg = 2; // Sound Bypasses normal Chrome shields by definition unless it's a direct deflection check
          }
        } else if (rawDmg > 0) {
          // Check opponent barrier
          if (this.opponentBarrier) {
            const b = this.opponentBarrier.type;
            if (b === 'CHROME') {
              if ((pAction.archetype === 'PHYSICAL' || pAction.name === 'Pulse Bolt') && pAction.name !== 'Lightning Storm') {
                finalDmg = 0;
                logs.push(`[SHIELD] Opponent's Chrome Barrier absorbs Player's [${pAction.name}]!`);
                if (pAction.isLotusBud) {
                  pAction.overgrowthNullified = true;
                  logs.push(`[SHIELD] Opponent's Chrome Barrier nullifies the Overgrowth infestation.`);
                }
              }
            } else if (b === 'MIRROR') {
              if (pAction.isLotusBud) {
                this.opponentBarrier = null;
                logs.push(`[SHATTER] Player's Lotus projectile penetrates and shatters Opponent's Mirror Barrier!`);
              } else if (pAction.archetype === 'LIGHT') {
                finalDmg = 0;
                reflected = true;
                logs.push(`[REFLECT] Opponent's Mirror Barrier reflects Player's Light bolt back!`);
                let reflectedDmg = rawDmg;
                if (this.playerBarrier && this.playerBarrier.type === 'MIRROR') {
                  this.playerBarrier = null;
                  logs.push(`[SHATTER] The reflected light shatters Player's Mirror Barrier!`);
                }
                if (playerInvulnerable) {
                  logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! Player takes 0 REFLECTED damage.`);
                } else {
                  this.playerHP -= reflectedDmg;
                  logs.push(`>> Player takes ${reflectedDmg} REFLECTED damage.`);
                }
              } else if (pAction.archetype === 'PHYSICAL') {
                this.opponentBarrier = null;
                logs.push(`[SHATTER] Player's physical strike shatters Opponent's Mirror Barrier!`);
              }
            }
          }
          if (finalDmg > 0 && pAction.archetype === 'PHYSICAL' && this.opponentArmorBuffer > 0) {
            finalDmg = Math.max(0, finalDmg - 1);
            this.opponentArmorBuffer--;
            logs.push(`[ARMOR] Opponent's armor buffer reduces Physical damage by 1 (1 charge consumed).`);
          }
        }

        let hitOpponent = (finalDmg > 0 || (pAction.isLotusBud && !pAction.overgrowthNullified)) && !reflected;
        if (hitOpponent) {
          // Sonic Anvil Counter Backlash Check for Opponent
          if (this.opponentSonicAnvilActive && (pAction.archetype === 'PHYSICAL' || pAction.archetype === 'LIGHT')) {
            finalDmg = Math.max(0, finalDmg - 1);
            playerBacklash += 2;
            logs.push(`[SONIC ANVIL] Opponent's Sonic Anvil absorbs 1 DMG and triggers 2 HP backlash on Player!`);
          }
          if (opponentInvulnerable) {
            logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! Player's [${pAction.name}] deals 0 DMG.`);
          } else {
            if (finalDmg > 0) {
              if (this.opponentCharlesTotemTurns > 0) {
                this.opponentHP = Math.min(10, this.opponentHP + finalDmg);
                logs.push(`[INVERSION] Charles Totem inverts damage! Opponent heals for ${finalDmg} HP instead.`);
              } else {
                this.opponentHP -= finalDmg;
                logs.push(`>> Player strikes Opponent for ${finalDmg} DMG.`);
              }
            }
            if (pAction.isCharles) {
              this.opponentCharlesTotemTurns = 2;
              this.playerCharlesCooldown = 5; // 2 turns active + 3 turns cooldown
              logs.push(`* Opponent is afflicted by Charles Inverse Totem (2 turns)!`);
            }
            if (pAction.isLotusBud && !pAction.overgrowthNullified) {
              this.opponentOvergrowthTurns = 2;
              logs.push(`* Opponent is infested with Overgrowth (2 turns)! Key 1 and Key 4 disabled.`);
            }
            if (pAction.isBeyondVoid) {
              this.opponentForceSelfCastNextTurn = true;
              logs.push(`* Opponent is struck by BEYOND VOID and forced into SELF-CAST ONLY next turn!`);
            }
            if (pAction.lifesteal && finalDmg > 0) {
              this.playerHP = Math.min(10, this.playerHP + finalDmg);
              logs.push(`+ Lifesteal: Player restores +${finalDmg} HP.`);
            }
            if (pAction.isCorrosive) {
              this.opponentStatuses.push({
                id: 'corrosion_tick',
                type: 'DECAY',
                turnsLeft: 1,
                valPerTurn: 1,
                isDebuff: true,
                name: 'Corrosion'
              });
              logs.push(`* Opponent is infected with Corrosion (+1 DMG next turn).`);
            }
          }
        }
      }
    }

    // B. Opponent Projectile hitting Player
    if (oAction.type === 'PROJECTILE' && !oProjCancelled) {
      if (oAction.isDelayedStrike) {
        if (playerInvulnerable) {
          logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! Delayed Strike is negated.`);
        } else if (this.playerBarrier && this.playerBarrier.type === 'MIRROR') {
          this.playerBarrier = null;
          logs.push(`[SHATTER] Opponent's Delayed Strike shatters Player's Mirror Barrier and is neutralized!`);
        } else {
          this.playerStatuses.push({
            id: 'delayed_strike',
            type: 'ECHO',
            turnsLeft: 2, // Set to 2 turns so it does 0 damage this turn and detonates next turn
            valPerTurn: 0,
            isDebuff: true,
            name: 'Delayed Strike'
          });
          logs.push(`* Opponent applies Delayed Strike to Player! Resonance overlay active.`);
        }
      } else if (oAction.isInternalResonance) {
        if (playerInvulnerable) {
          logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! Piercing Blood is negated.`);
        } else {
          this.playerInternalResonanceTurns = 2;
          logs.push(`* Opponent inflicts Piercing Blood on Player (2 turns)!`);
        }
      } else if (oAction.isThunderclapCleanse) {
        this.playerStatuses = this.playerStatuses.filter(s => s.type !== 'DECAY' && s.type !== 'CLOUD');
        this.playerSmokescreenTurns = 0;
        this.playerBlindTurns = 0;
        logs.push(`[CLEANSE] Opponent's Thunderclap Cleanse dissipates all cloud fields and gas effects on Player.`);
      } else if (oAction.isGas && oAction.duration) {
        if (oAction.isSporeGrid) {
          if (playerInvulnerable) {
            logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! Spore Grid trap is negated.`);
          } else {
            this.playerSporeGridTurns = 2;
            logs.push(`* Opponent deploys a pink Spore Grid trap on Player's zone (2 turns).`);
          }
        } else if (oAction.isAOE) {
          if (playerInvulnerable) {
            logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! Player takes 0 DMG.`);
          } else {
            this.playerHP -= 4;
          }
          logs.push(`* Opponent's Lightning Storm Gas detonates! Player takes ${playerInvulnerable ? 0 : 4} DMG.`);
        } else {
          if (playerInvulnerable) {
            logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! [${oAction.name}] is negated.`);
          } else {
            // Apply DOT to player
            this.playerStatuses.push({
              id: oAction.name === 'Decay Gas' ? 'decay_gas' : (oAction.name === 'Fog Shard' ? 'fog' : 'lightning_gas'),
              type: oAction.name === 'Decay Gas' ? 'DECAY' : (oAction.name === 'Fog Shard' ? 'CLOUD' : 'PULSE'),
              turnsLeft: oAction.duration,
              valPerTurn: Number(oAction.damage) || 0,
              isDebuff: true,
              name: oAction.name === 'Fog Shard' ? 'Fog' : oAction.name
            });
            if (oAction.name === 'Fog Shard') {
              logs.push(`* Opponent envelops Player in a thick [Fog] (3 turns).`);
            } else {
              logs.push(`* Opponent traps Player in a corrosive [${oAction.name}] (2 turns).`);
            }
          }
        }
      } else {
        let rawDmg = oAction.damage || 0;
        if (oAction.name === 'Pulse Bolt') {
          const playerHasHealingMist = this.playerStatuses.some(s => s.name === 'Healing Mist' || s.id === 'healing_mist');
          const playerHasGas = this.playerStatuses.some(s => s.name === 'Decay Gas' || s.name === 'Fog' || s.name === 'Lightning Storm Gas' || s.id === 'decay_gas' || s.id === 'fog' || s.id === 'lightning_gas');
          
          if (playerHasHealingMist) {
            oAction.name = 'Lightning Strike';
            rawDmg = 4;
            // Clear healing mist
            this.playerStatuses = this.playerStatuses.filter(s => s.name !== 'Healing Mist' && s.id !== 'healing_mist');
            logs.push(`[LIGHTNING STRIKE] Opponent's Pulse electrifies Player's Healing Mist! Healing is nullified and Player takes 4 Electrical DMG.`);
          } else if (playerHasGas) {
            oAction.name = 'Lightning Storm';
            rawDmg = 4;
            logs.push(`[LIGHTNING STORM] Opponent's Pulse electrifies the lingering gas, triggering a Lightning Storm! (Deals 4 DMG)`);
          }
        }
        let finalDmg = rawDmg;
        let reflected = false;

        if (oAction.isArmorBuff) {
          this.opponentArmorBuffer++;
          logs.push(`* Opponent gains a permanent 1-point armor buffer.`);
        }

        if (oAction.isSpikedRose) {
          if (this.playerBarrier) {
            logs.push(`[SHATTER] Spiked Iron Rose splinters on impact, shattering Player's ${this.playerBarrier.type} Barrier!`);
            this.playerBarrier = null;
            finalDmg = 1;
          } else {
            finalDmg = 3;
          }
        } else if (oAction.isSonicRailgun) {
          if (this.playerBarrier) {
            if (this.playerBarrier.type === 'MIRROR') {
              this.playerBarrier = null;
              finalDmg = 4;
              logs.push(`[SHATTER] Sonic Railgun shatters Player's Mirror Barrier! (Deals 4 DMG)`);
            } else if (this.playerBarrier.type === 'CHROME') {
              finalDmg = 0;
              this.opponentStallTurns = 1;
              logs.push(`[RECOIL] Sonic Railgun impacts Chrome Barrier! Opponent is stalled/recoiled for 1 turn, defender takes 0 DMG.`);
            }
          } else {
            finalDmg = 2; // lowered to 2 DMG per balance patch
          }
        } else if (oAction.isEchoWave) {
          if (this.playerBarrier) {
            if (this.playerBarrier.type === 'MIRROR') {
              this.playerBarrier = null;
              finalDmg = 1;
              logs.push(`[SHATTER] Echo Wave shatters Player's Mirror Barrier! (Deals 1 piercing DMG)`);
            } else if (this.playerBarrier.type === 'CHROME') {
              finalDmg = 0;
              opponentBacklash += 3;
              logs.push(`[DEFLECT] Echo Wave deflects on Player's Chrome Barrier! Opponent takes 3 HP Reflected DMG, player takes 0.`);
            }
          } else {
            finalDmg = 2;
          }
        } else if (rawDmg > 0) {
          if (this.playerBarrier) {
            const b = this.playerBarrier.type;
            if (b === 'CHROME') {
              if ((oAction.archetype === 'PHYSICAL' || oAction.name === 'Pulse Bolt') && oAction.name !== 'Lightning Storm') {
                finalDmg = 0;
                logs.push(`[SHIELD] Player's Chrome Barrier absorbs Opponent's [${oAction.name}]!`);
                if (oAction.isLotusBud) {
                  oAction.overgrowthNullified = true;
                  logs.push(`[SHIELD] Player's Chrome Barrier nullifies the Overgrowth infestation.`);
                }
              }
            } else if (b === 'MIRROR') {
              if (oAction.isLotusBud) {
                this.playerBarrier = null;
                logs.push(`[SHATTER] Opponent's Lotus projectile penetrates and shatters Player's Mirror Barrier!`);
              } else if (oAction.archetype === 'LIGHT') {
                finalDmg = 0;
                reflected = true;
                logs.push(`[REFLECT] Player's Mirror Barrier reflects Opponent's Light bolt back!`);
                let reflectedDmg = rawDmg;
                if (this.opponentBarrier && this.opponentBarrier.type === 'MIRROR') {
                  this.opponentBarrier = null;
                  logs.push(`[SHATTER] The reflected light shatters Opponent's Mirror Barrier!`);
                }
                if (opponentInvulnerable) {
                  logs.push(`[INVULNERABLE] Opponent is invulnerable under Void Shelter! Opponent takes 0 REFLECTED damage.`);
                } else {
                  this.opponentHP -= reflectedDmg;
                  logs.push(`>> Opponent takes ${reflectedDmg} REFLECTED damage.`);
                }
              } else if (oAction.archetype === 'PHYSICAL') {
                this.playerBarrier = null;
                logs.push(`[SHATTER] Opponent's physical strike shatters Player's Mirror Barrier!`);
              }
            }
          }
          if (finalDmg > 0 && oAction.archetype === 'PHYSICAL' && this.playerArmorBuffer > 0) {
            finalDmg = Math.max(0, finalDmg - 1);
            this.playerArmorBuffer--;
            logs.push(`[ARMOR] Player's armor buffer reduces Physical damage by 1 (1 charge consumed).`);
          }
        }

        let hitPlayer = (finalDmg > 0 || (oAction.isLotusBud && !oAction.overgrowthNullified)) && !reflected;
        if (hitPlayer) {
          // Sonic Anvil Counter Backlash Check for Player
          if (this.playerSonicAnvilActive && (oAction.archetype === 'PHYSICAL' || oAction.archetype === 'LIGHT')) {
            finalDmg = Math.max(0, finalDmg - 1);
            opponentBacklash += 2;
            logs.push(`[SONIC ANVIL] Player's Sonic Anvil absorbs 1 DMG and triggers 2 HP backlash on Opponent!`);
          }
          if (playerInvulnerable) {
            logs.push(`[INVULNERABLE] Player is invulnerable under Void Shelter! Opponent's [${oAction.name}] deals 0 DMG.`);
          } else {
            if (finalDmg > 0) {
              if (this.playerCharlesTotemTurns > 0) {
                this.playerHP = Math.min(10, this.playerHP + finalDmg);
                logs.push(`[INVERSION] Charles Totem inverts damage! Player heals for ${finalDmg} HP instead.`);
              } else {
                this.playerHP -= finalDmg;
                logs.push(`>> Opponent strikes Player for ${finalDmg} DMG.`);
              }
            }
            if (oAction.isCharles) {
              this.playerCharlesTotemTurns = 2;
              this.opponentCharlesCooldown = 5;
              logs.push(`* Player is afflicted by Charles Inverse Totem (2 turns)!`);
            }
            if (oAction.isLotusBud && !oAction.overgrowthNullified) {
              this.playerOvergrowthTurns = 2;
              logs.push(`* Player is infested with Overgrowth (2 turns)! Key 1 and Key 4 disabled.`);
            }
            if (oAction.isBeyondVoid) {
              this.playerForceSelfCastNextTurn = true;
              logs.push(`* Player is struck by BEYOND VOID and forced into SELF-CAST ONLY next turn!`);
            }
            if (oAction.lifesteal && finalDmg > 0) {
              this.opponentHP = Math.min(10, this.opponentHP + finalDmg);
              logs.push(`+ Lifesteal: Opponent restores +${finalDmg} HP.`);
            }
            if (oAction.isCorrosive) {
              this.playerStatuses.push({
                id: 'corrosion_tick',
                type: 'DECAY',
                turnsLeft: 1,
                valPerTurn: 1,
                isDebuff: true,
                name: 'Corrosion'
              });
              logs.push(`* Player is infected with Corrosion (+1 DMG next turn).`);
            }
          }
        }
      }
    }

    // Apply backlashes
    if (playerBacklash > 0) {
      this.playerHP -= playerBacklash;
    }
    if (opponentBacklash > 0) {
      this.opponentHP -= opponentBacklash;
    }

    // Resolve passive statuses (DOTs / HOTs / Corrosion ticks) at the end of the turn
    this.resolveStatusEffects(logs);

    // Decrement visual clocks
    if (this.playerBlindTurns > 0) this.playerBlindTurns--;
    if (this.opponentBlindTurns > 0) this.opponentBlindTurns--;
    if (this.playerSmokescreenTurns > 0) this.playerSmokescreenTurns--;
    if (this.opponentSmokescreenTurns > 0) this.opponentSmokescreenTurns--;
    if (this.playerOvergrowthTurns > 0) this.playerOvergrowthTurns--;
    if (this.opponentOvergrowthTurns > 0) this.opponentOvergrowthTurns--;
    if (this.playerSporeGridTurns > 0) this.playerSporeGridTurns--;
    if (this.opponentSporeGridTurns > 0) this.opponentSporeGridTurns--;

    // Tick/Decrement active barriers
    if (this.playerBarrier) {
      this.playerBarrier.turnsLeft--;
      if (this.playerBarrier.turnsLeft <= 0) {
        logs.push(`- Player's ${this.playerBarrier.type} barrier dissolves.`);
        this.playerBarrier = null;
      }
    }
    if (this.opponentBarrier) {
      this.opponentBarrier.turnsLeft--;
      if (this.opponentBarrier.turnsLeft <= 0) {
        logs.push(`- Opponent's ${this.opponentBarrier.type} barrier dissolves.`);
        this.opponentBarrier = null;
      }
    }

    // Clamp HPs
    this.playerHP = Math.max(0, this.playerHP);
    this.opponentHP = Math.max(0, this.opponentHP);

    // Check game over
    if (this.playerHP <= 0 && this.opponentHP <= 0) {
      logs.push(`MUTUAL ANNIHILATION. BOTH COMBATANTS HAVE FALLEN.`);
    } else if (this.playerHP <= 0) {
      logs.push(`DEFEAT. METALHEART MATRIX SHATTERED.`);
    } else if (this.opponentHP <= 0) {
      logs.push(`VICTORY! OPPONENT MESH SHATTERED. ARENA CONQUERED.`);
    }

    this.playerCastCloudLastTurn = playerCombo.includes('CLOUD');
    this.opponentCastCloudLastTurn = oppActionData.combo.includes('CLOUD');

    if (this.playerVoidSelfCastCooldown > 0) this.playerVoidSelfCastCooldown--;
    if (this.opponentVoidSelfCastCooldown > 0) this.opponentVoidSelfCastCooldown--;

    if (this.playerCharlesTotemTurns > 0) this.playerCharlesTotemTurns--;
    if (this.opponentCharlesTotemTurns > 0) this.opponentCharlesTotemTurns--;
    if (this.playerCharlesCooldown > 0) this.playerCharlesCooldown--;
    if (this.opponentCharlesCooldown > 0) this.opponentCharlesCooldown--;

    if (this.playerEchoCooldown > 0) this.playerEchoCooldown--;
    if (this.opponentEchoCooldown > 0) this.opponentEchoCooldown--;

    this.logs.unshift(...logs.reverse());
    this.turnNumber++;

    return {
      pAction,
      oAction,
      pProjCancelled,
      oProjCancelled,
      logs
    };
  }

  /**
   * Resolves active status ticks.
   */
  resolveStatusEffects(logs) {
    // Player status ticks
    // Check if player is invulnerable this turn (Void Shelter is active if playerStatuses is empty, but we pass it as parameter or check locally)
    // Actually, Void Shelter purges playerStatuses immediately in resolveTurn, so we don't have to worry about old ones.
    this.playerStatuses.forEach(s => {
      s.turnsLeft = (Number(s.turnsLeft) || 1) - 1;
      const val = Number(s.valPerTurn) || 0;
      if (!isFinite(val) || isNaN(val)) {
        s.valPerTurn = 0;
      }
      
      let amt = Number(s.valPerTurn) || 0;
      if (s.id === 'delayed_strike') {
        if (s.turnsLeft === 0) {
          let detDmg = 4;
          if (this.playerBarrier && this.playerBarrier.type === 'CHROME') {
            detDmg = 6;
          }
          const hasFog = this.playerStatuses.some(status => status.id === 'fog');
          if (this.playerSmokescreenTurns > 0 || hasFog) {
            detDmg = 0;
            logs.push(`[DELAYED STRIKE] Detonation on Player is negated by smokescreen/fog!`);
          } else {
            this.playerHP -= detDmg;
            logs.push(`[DELAYED STRIKE] Detonation deals ${detDmg} Sound DMG to Player!`);
          }
        }
        return;
      }

      if (s.isDebuff) {
        if (this.playerHarmonicCleanseActive) {
          logs.push(`[HARMONIC CLEANSE] Player is immune to debuff ticks! [${s.name}] tick is negated.`);
        } else if (this.playerCharlesTotemTurns > 0) {
          const baseHP = typeof this.playerHP === 'number' && !isNaN(this.playerHP) ? this.playerHP : 10;
          this.playerHP = Math.min(10, baseHP + amt);
          logs.push(`[INVERSION] Charles Totem inverts poison! Player heals +${amt} HP from [${s.name}]. (${s.turnsLeft} turns remain)`);
        } else {
          const baseHP = typeof this.playerHP === 'number' && !isNaN(this.playerHP) ? this.playerHP : 10;
          this.playerHP = baseHP - amt;
          logs.push(`[GAS DOT] Player takes ${amt} DMG from active [${s.name}]. (${s.turnsLeft} turns remain)`);
        }
      } else {
        if (this.playerInternalResonanceTurns > 0) {
          logs.push(`[RESONANCE] Player's regeneration from [${s.name}] is blocked by Piercing Blood!`);
        } else if (this.playerCharlesTotemTurns > 0) {
          const baseHP = typeof this.playerHP === 'number' && !isNaN(this.playerHP) ? this.playerHP : 10;
          this.playerHP = baseHP - amt;
          logs.push(`[INVERSION] Charles Totem inverts regeneration! Player takes ${amt} DMG from [${s.name}]. (${s.turnsLeft} turns remain)`);
        } else {
          const baseHP = typeof this.playerHP === 'number' && !isNaN(this.playerHP) ? this.playerHP : 10;
          this.playerHP = Math.min(10, baseHP + amt);
          logs.push(`[REGEN] Player restores +${amt} HP from [${s.name}]. (${s.turnsLeft} turns remain)`);
        }
      }
    });
    this.playerStatuses = this.playerStatuses.filter(s => s.turnsLeft > 0);

    // Opponent status ticks
    this.opponentStatuses.forEach(s => {
      s.turnsLeft = (Number(s.turnsLeft) || 1) - 1;
      const val = Number(s.valPerTurn) || 0;
      if (!isFinite(val) || isNaN(val)) {
        s.valPerTurn = 0;
      }
      
      let amt = Number(s.valPerTurn) || 0;
      if (s.id === 'delayed_strike') {
        if (s.turnsLeft === 0) {
          let detDmg = 4;
          if (this.opponentBarrier && this.opponentBarrier.type === 'CHROME') {
            detDmg = 6;
          }
          const hasFog = this.opponentStatuses.some(status => status.id === 'fog');
          if (this.opponentSmokescreenTurns > 0 || hasFog) {
            detDmg = 0;
            logs.push(`[DELAYED STRIKE] Detonation on Opponent is negated by smokescreen/fog!`);
          } else {
            this.opponentHP -= detDmg;
            logs.push(`[DELAYED STRIKE] Detonation deals ${detDmg} Sound DMG to Opponent!`);
          }
        }
        return;
      }

      if (s.isDebuff) {
        if (this.opponentHarmonicCleanseActive) {
          logs.push(`[HARMONIC CLEANSE] Opponent is immune to debuff ticks! [${s.name}] tick is negated.`);
        } else if (this.opponentCharlesTotemTurns > 0) {
          const baseHP = typeof this.opponentHP === 'number' && !isNaN(this.opponentHP) ? this.opponentHP : 10;
          this.opponentHP = Math.min(10, baseHP + amt);
          logs.push(`[INVERSION] Charles Totem inverts poison! Opponent heals +${amt} HP from [${s.name}]. (${s.turnsLeft} turns remain)`);
        } else {
          const baseHP = typeof this.opponentHP === 'number' && !isNaN(this.opponentHP) ? this.opponentHP : 10;
          this.opponentHP = baseHP - amt;
          logs.push(`[GAS DOT] Opponent takes ${amt} DMG from active [${s.name}]. (${s.turnsLeft} turns remain)`);
        }
      } else {
        if (this.opponentInternalResonanceTurns > 0) {
          logs.push(`[RESONANCE] Opponent's regeneration from [${s.name}] is blocked by Piercing Blood!`);
        } else if (this.opponentCharlesTotemTurns > 0) {
          const baseHP = typeof this.opponentHP === 'number' && !isNaN(this.opponentHP) ? this.opponentHP : 10;
          this.opponentHP = baseHP - amt;
          logs.push(`[INVERSION] Charles Totem inverts regeneration! Opponent takes ${amt} DMG from [${s.name}]. (${s.turnsLeft} turns remain)`);
        } else {
          const baseHP = typeof this.opponentHP === 'number' && !isNaN(this.opponentHP) ? this.opponentHP : 10;
          this.opponentHP = Math.min(10, baseHP + amt);
          logs.push(`[REGEN] Opponent restores +${amt} HP from [${s.name}]. (${s.turnsLeft} turns remain)`);
        }
      }
    });
    this.opponentStatuses = this.opponentStatuses.filter(s => s.turnsLeft > 0);

    // Final sanity check for playerHP/opponentHP to prevent God Mode / Invisible HP locks!
    if (isNaN(this.playerHP) || !isFinite(this.playerHP)) {
      this.playerHP = 10;
    }
    if (isNaN(this.opponentHP) || !isFinite(this.opponentHP)) {
      this.opponentHP = 10;
    }
  }
}
