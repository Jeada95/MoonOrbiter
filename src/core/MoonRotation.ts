import * as THREE from 'three';

/**
 * Contrôle la rotation de la Lune sur elle-même via les flèches du clavier.
 * La rotation est cumulative avec inertie (décélération progressive).
 * Touche Espace = arrêter la rotation.
 * Touche Home = réinitialiser orientation + arrêter la rotation.
 */
export class MoonRotation {
  /** Vitesse angulaire actuelle (radians/seconde) sur chaque axe */
  private velocityX = 0; // flèches haut/bas → rotation autour de l'axe X (inclinaison)
  private velocityY = 0; // flèches gauche/droite → rotation autour de l'axe Y (spin)

  /** Accélération quand la touche est maintenue (rad/s²) */
  private readonly ACCEL = 0.8;

  /** Facteur de friction (décélération par frame, 0.98 = lente, 0.90 = rapide) */
  private readonly FRICTION = 0.985;

  /** Seuil en dessous duquel on coupe la vitesse */
  private readonly MIN_SPEED = 0.0001;

  /** État des touches */
  private keys = { up: false, down: false, left: false, right: false };

  /** Temps du dernier frame (pour dt) */
  private lastTime = 0;

  /** Quaternion initial du mesh (pour le reset) */
  private initialQuaternion: THREE.Quaternion;

  constructor(private mesh: THREE.Object3D) {
    this.initialQuaternion = mesh.quaternion.clone();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowUp':    this.keys.up = true; e.preventDefault(); break;
      case 'ArrowDown':  this.keys.down = true; e.preventDefault(); break;
      case 'ArrowLeft':  this.keys.left = true; e.preventDefault(); break;
      case 'ArrowRight': this.keys.right = true; e.preventDefault(); break;
      case 'Space':
        // Stop rotation
        this.velocityX = 0;
        this.velocityY = 0;
        e.preventDefault();
        break;
      case 'Home':
        // Reset orientation + stop
        this.velocityX = 0;
        this.velocityY = 0;
        this.mesh.quaternion.copy(this.initialQuaternion);
        e.preventDefault();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowUp':    this.keys.up = false; break;
      case 'ArrowDown':  this.keys.down = false; break;
      case 'ArrowLeft':  this.keys.left = false; break;
      case 'ArrowRight': this.keys.right = false; break;
    }
  };

  /** Appelé chaque frame avec le temps en millisecondes */
  update(time: number) {
    const dt = this.lastTime === 0 ? 1 / 60 : (time - this.lastTime) / 1000;
    this.lastTime = time;

    // Clamper dt pour éviter les gros sauts
    const clampedDt = Math.min(dt, 0.1);

    // Accélération si touches maintenues
    if (this.keys.up)    this.velocityX -= this.ACCEL * clampedDt;
    if (this.keys.down)  this.velocityX += this.ACCEL * clampedDt;
    if (this.keys.left)  this.velocityY -= this.ACCEL * clampedDt;
    if (this.keys.right) this.velocityY += this.ACCEL * clampedDt;

    // Friction (décélération)
    this.velocityX *= this.FRICTION;
    this.velocityY *= this.FRICTION;

    // Couper si trop faible
    if (Math.abs(this.velocityX) < this.MIN_SPEED) this.velocityX = 0;
    if (Math.abs(this.velocityY) < this.MIN_SPEED) this.velocityY = 0;

    // Appliquer la rotation
    if (this.velocityX !== 0 || this.velocityY !== 0) {
      const qX = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        this.velocityX * clampedDt
      );
      const qY = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.velocityY * clampedDt
      );

      this.mesh.quaternion.premultiply(qX);
      this.mesh.quaternion.premultiply(qY);
    }
  }

  /** La Lune est-elle en rotation ? */
  get isSpinning(): boolean {
    return this.velocityX !== 0 || this.velocityY !== 0;
  }

  /** Vitesse actuelle pour affichage */
  get speed(): number {
    return Math.sqrt(this.velocityX ** 2 + this.velocityY ** 2);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
