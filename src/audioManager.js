export class AudioManager {
  constructor() {
    this.tracks = {
      menu1: new Audio('/audio/menu_theme.mp3'),
      menu2: new Audio('/audio/menu_theme2.mp3'),
      menu3: new Audio('/audio/menu_theme3.mp3'),
      battle1: new Audio('/audio/battle_theme_1.mp3'),
      battle2: new Audio('/audio/battle_theme_2.mp3'),
      battle3: new Audio('/audio/battle_theme_3.mp3'),
      battle4: new Audio('/audio/battle_theme_4.mp3'),
      battle5: new Audio('/audio/battle_theme_5.mp3'),
      battle6: new Audio('/audio/battle_theme_6.mp3')
    };

    // Configure loop and starting volume
    Object.keys(this.tracks).forEach(key => {
      const audio = this.tracks[key];
      audio.loop = true;
      audio.volume = 0.0;
    });

    this.projectionSounds = [
      new Audio('/audio/projection1.wav'),
      new Audio('/audio/projection2.wav'),
      new Audio('/audio/projection3.wav')
    ];

    this.selfCastSound = new Audio('/audio/selfcast.wav');

    this.currentTrack = null;
    this.isMuted = false;
    this.audioUnlocked = false;
  }

  // Unlocks browser Web Audio on first click
  unlock() {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    
    // Play active track if any
    if (this.currentTrack && !this.isMuted) {
      this.currentTrack.play()
        .then(() => {
          this.fadeVolume(this.currentTrack, 0.80, 1000);
        })
        .catch(err => {
          console.log("Audio unlock play failed:", err);
        });
    }
  }

  playTrack(trackName) {
    const nextTrack = this.tracks[trackName];
    if (!nextTrack || nextTrack === this.currentTrack) return;

    const prevTrack = this.currentTrack;
    this.currentTrack = nextTrack;

    if (this.isMuted) {
      if (prevTrack) prevTrack.pause();
      return;
    }

    // Play next track
    nextTrack.volume = 0.0;
    nextTrack.play()
      .then(() => {
        this.fadeVolume(nextTrack, 0.80, 1200);
      })
      .catch(err => {
        console.log("Audio track play deferred (waiting for unlock):", err);
      });

    // Fade out previous track
    if (prevTrack) {
      this.fadeVolume(prevTrack, 0.0, 1000, () => {
        prevTrack.pause();
      });
    }
  }

  fadeVolume(audio, targetVol, duration, onComplete = null) {
    const steps = 20;
    const interval = duration / steps;
    const startVol = audio.volume;
    const diff = targetVol - startVol;
    let currentStep = 0;

    const timer = setInterval(() => {
      currentStep++;
      audio.volume = Math.max(0.0, Math.min(1.0, startVol + diff * (currentStep / steps)));
      if (currentStep >= steps) {
        clearInterval(timer);
        audio.volume = targetVol;
        if (onComplete) onComplete();
      }
    }, interval);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    
    if (this.isMuted) {
      Object.values(this.tracks).forEach(audio => {
        audio.volume = 0.0;
        audio.pause();
      });
      this.projectionSounds.forEach(audio => {
        audio.volume = 0.0;
        audio.pause();
      });
      this.selfCastSound.volume = 0.0;
      this.selfCastSound.pause();
    } else {
      if (this.currentTrack) {
        this.currentTrack.play()
          .then(() => {
            this.fadeVolume(this.currentTrack, 0.80, 600);
          })
          .catch(err => {
            console.log("Audio toggle resume failed:", err);
          });
      }
    }

    return this.isMuted;
  }

  playSelfCast() {
    if (this.isMuted) return;
    this.selfCastSound.currentTime = 0;
    this.selfCastSound.volume = 0.55;
    this.selfCastSound.play().catch(err => {
      console.log("SelfCast play failed (possibly deferred):", err);
    });
  }

  playProjection() {
    if (this.isMuted) return;
    const sound = this.projectionSounds[Math.floor(Math.random() * this.projectionSounds.length)];
    sound.currentTime = 0;
    sound.volume = 0.45;
    sound.play().catch(err => {
      console.log("Projection play failed (possibly deferred):", err);
    });
  }
}
