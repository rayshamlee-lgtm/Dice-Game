import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// --- Types & Constants ---
const GameState = { IDLE: 'IDLE', SHAKING: 'SHAKING', OPENED: 'OPENED', SETTINGS: 'SETTINGS' };
const TAP_THRESHOLD = 10;
const DRAG_FULL_DISTANCE = 250;
const SHAKE_DURATION = 800;
const CUP_TARGET_OPEN = { y: 12, z: -4, rotX: -Math.PI / 4 };
const CUP_TARGET_CLOSED = { y: 0, z: 0, rotX: 0 };
const DICE_SIZE = 0.95;
const DICE_RADIUS = 0.18;
const CUP_HEIGHT = 7.0;
const CUP_RADIUS_TOP = 2.6;
const CUP_RADIUS_OPEN = 3.4;
const CAM_POS_FAR = new THREE.Vector3(0, 14, 20);
const CAM_POS_CLOSE = new THREE.Vector3(0, 12, 4);
const LOOK_AT_FAR = new THREE.Vector3(0, 3, 0);
const LOOK_AT_CLOSE = new THREE.Vector3(0, 0.5, 0);

// --- Perlin Noise ---
const Perlin = (function() {
    const p = new Uint8Array(512);
    const permutation = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
    for (let i=0; i < 256 ; i++) p[256+i] = p[i] = permutation[i];
    function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(t: number, a: number, b: number) { return a + t * (b - a); }
    function grad(hash: number, x: number, y: number, z: number) {
        const h = hash & 15; const u = h<8 ? x : y, v = h<4 ? y : h==12||h==14 ? x : z;
        return ((h&1) == 0 ? u : -u) + ((h&2) == 0 ? v : -v);
    }
    return {
        noise: function (x: number, y: number, z: number) {
            const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
            x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
            const u = fade(x), v = fade(y), w = fade(z);
            const A = p[X]+Y, AA = p[A]+Z, AB = p[A+1]+Z, B = p[X+1]+Y, BA = p[B]+Z, BB = p[B+1]+Z;
            return lerp(w, lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x-1, y, z)),
                            lerp(u, grad(p[AB], x, y-1, z), grad(p[BB], x-1, y-1, z))),
                    lerp(v, lerp(u, grad(p[AA+1], x, y, z-1), grad(p[BA+1], x-1, y, z-1)),
                            lerp(u, grad(p[AB+1], x, y-1, z-1), grad(p[BB+1], x-1, y-1, z-1))));
        }
    };
})();

// --- Sound Manager ---
const SoundManager = {
    ctx: null as AudioContext | null, 
    noiseBuffer: null as AudioBuffer | null,
    init: function() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            this.ctx = new AudioContext();
            this.createNoiseBuffer();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    createNoiseBuffer: function() {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        let lastOut = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            data[i] = (lastOut + (0.05 * white)) / 1.05;
            lastOut = data[i];
            data[i] *= 3.5; 
        }
    },
    playUI: function(type: 'add' | 'remove') {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        if (type === 'add') {
            osc.frequency.setValueAtTime(880, t);
            osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
            gain.gain.setValueAtTime(0.1, t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        } else {
            osc.frequency.setValueAtTime(440, t);
            osc.frequency.exponentialRampToValueAtTime(300, t + 0.08);
            gain.gain.setValueAtTime(0.1, t); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        }
        osc.start(t); osc.stop(t + 0.08);
    },
    playShake: function() {
        if (!this.ctx || !this.noiseBuffer) return;
        const t = this.ctx.currentTime;
        const hits = 5 + Math.floor(Math.random() * 4);
        const masterGain = this.ctx.createGain();
        masterGain.gain.value = 0.5; 
        masterGain.connect(this.ctx.destination);
        for(let i=0; i<hits; i++) {
            const offset = Math.random() * 0.1;
            const source = this.ctx.createBufferSource();
            source.buffer = this.noiseBuffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass'; 
            filter.frequency.value = 400 + Math.random() * 800; 
            filter.Q.value = 1.5; 
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0, t + offset);
            gain.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.3, t + offset + 0.005); 
            gain.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.05);
            source.connect(filter); filter.connect(gain); gain.connect(masterGain); 
            source.start(t + offset); source.stop(t + offset + 0.08);
        }
    },
    playClose: function() {
        if (!this.ctx || !this.noiseBuffer) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
        oscGain.gain.setValueAtTime(0.2, t); oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(oscGain); oscGain.connect(this.ctx.destination);
        osc.start(t); osc.stop(t + 0.2);
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 500;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        source.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
        source.start(t); source.stop(t + 0.15);
    },
    playOpen: function() {
        if (!this.ctx || !this.noiseBuffer) return;
        const t = this.ctx.currentTime;
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.Q.value = 0.5;
        filter.frequency.setValueAtTime(200, t);
        filter.frequency.exponentialRampToValueAtTime(1200, t + 0.2); 
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.05); 
        gain.gain.linearRampToValueAtTime(0, t + 0.25); 
        source.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
        source.start(t); source.stop(t + 0.3);
    }
};

// --- LightRay Manager ---
const LightRayManager = {
    canvas: null as HTMLCanvasElement | null, 
    ctx: null as CanvasRenderingContext2D | null,
    sparkleTexture: null as HTMLCanvasElement | null, 
    coreTexture: null as HTMLCanvasElement | null, 
    isActive: false, rotation: 0, opacity: 0, scale: 1, state: 'hidden', activeTimer: 0, 
    sparkles: [] as any[], 
    
    init: function(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.createSparkleTexture(); 
        this.createCoreTexture(); 
        this.resize();
    },
    
    createSparkleTexture: function() {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if(!ctx) return;
        const cx = size / 2; const cy = size / 2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.3, 'rgba(255, 220, 100, 0.8)');
        grad.addColorStop(1, 'rgba(255, 220, 100, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        this.sparkleTexture = canvas;
    },

    createCoreTexture: function() {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if(!ctx) return;
        const cx = size / 2; const cy = size / 2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, 0)'); 
        grad.addColorStop(0.45, 'rgba(255, 255, 255, 0)'); 
        grad.addColorStop(0.65, 'rgba(255, 220, 100, 0.4)'); 
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        this.coreTexture = canvas;
    },

    resize: function() { 
        if(this.canvas) {
            this.canvas.width = window.innerWidth; 
            this.canvas.height = window.innerHeight; 
        }
    },
    
    trigger: function() {
        this.isActive = true; this.state = 'fading_in'; this.opacity = 0; this.rotation = 0; this.scale = 0.5; this.activeTimer = 0;
        this.sparkles = []; 
        this.spawnSparkles(300); 
    },

    spawnSparkles: function(count: number) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const initialRadius = 120 + Math.random() * 50; 
            const life = 250 + Math.random() * 200; 
            this.sparkles.push({
                x: Math.cos(angle) * initialRadius,
                y: Math.sin(angle) * initialRadius,
                angle: angle, 
                speed: 0.5 + Math.random() * 2.0, 
                scale: 0.3 + Math.random() * 0.7, 
                alphaConst: 0.5 + Math.random() * 0.5,
                life: life,
                maxLife: life 
            });
        }
    },
    
    animate: function() {
        if (!this.isActive || !this.ctx || !this.canvas) return;
        const ctx = this.ctx; const w = this.canvas.width; const h = this.canvas.height; 
        const centerW = w / 2; const centerH = h / 2;
        ctx.clearRect(0, 0, w, h);
        
        if (this.state === 'fading_in') { 
            this.opacity += 0.2; 
            if (this.opacity >= 1) { this.opacity = 1; this.state = 'active'; } 
        }
        else if (this.state === 'active') { 
            this.activeTimer++; 
            this.scale = 1.0 + Math.sin(this.activeTimer * 0.04) * 0.03; 
            if (this.activeTimer > 500) { this.state = 'fading_out'; } 
        }
        else if (this.state === 'fading_out') { 
            this.opacity -= 0.02; 
            if (this.opacity <= 0) { this.opacity = 0; this.isActive = false; this.state = 'hidden'; return; } 
        }
        
        this.rotation += 0.002; 
        ctx.save(); 
        ctx.translate(centerW, centerH); 
        
        if (this.coreTexture) {
            ctx.globalCompositeOperation = 'screen'; 
            const t = this.activeTimer;
            const duration = 160;
            const progress = Math.min(t / duration, 1.0);
            const ease = 1 - Math.pow(1 - progress, 3);
            const drift = t * 0.004;
            const currentScale = 0.6 + (1.3 * ease) + drift;
            let coreAlpha = 0;
            if (this.activeTimer < 20) { coreAlpha = this.activeTimer / 20; }
            else if (this.activeTimer < 250) { coreAlpha = 1.0; }
            else { coreAlpha = Math.max(0, 1 - (this.activeTimer - 250) / 150); }

            if (coreAlpha > 0) {
                ctx.save();
                ctx.scale(currentScale, currentScale); 
                ctx.globalAlpha = this.opacity * coreAlpha;
                const coreSize = 440; 
                ctx.drawImage(this.coreTexture, -coreSize/2, -coreSize/2, coreSize, coreSize);
                ctx.restore();
            }
        }
        ctx.restore(); 

        if (this.sparkleTexture && this.sparkles.length > 0) {
            ctx.save();
            ctx.translate(centerW, centerH);
            ctx.globalCompositeOperation = 'lighter'; 
            for (let i = this.sparkles.length - 1; i >= 0; i--) {
                let p = this.sparkles[i];
                p.x += Math.cos(p.angle) * p.speed;
                p.y += Math.sin(p.angle) * p.speed;
                p.life--;
                if (p.life <= 0) { this.sparkles.splice(i, 1); continue; }
                const lifeRatio = p.life / p.maxLife;
                let fadeAlpha = lifeRatio;
                ctx.globalAlpha = this.opacity * p.alphaConst * fadeAlpha;
                const size = 32 * p.scale;
                ctx.drawImage(this.sparkleTexture, p.x - size/2, p.y - size/2, size, size);
            }
            ctx.restore();
        }
    }
};

// --- React Component ---
function App() {
    const mountRef = useRef<HTMLDivElement>(null);
    const confettiRef = useRef<HTMLCanvasElement>(null);
    const [gameState, setGameState] = useState(GameState.IDLE);
    const [diceCount, setDiceCount] = useState(5);
    const [statusText, setStatusText] = useState("点击骰盅摇骰子");
    const [isCheatActive, setIsCheatActive] = useState(false);
    
    // Internal refs for Game Engine
    const engineRef = useRef({
        scene: null as THREE.Scene | null,
        camera: null as THREE.PerspectiveCamera | null,
        renderer: null as THREE.WebGLRenderer | null,
        cupMesh: null as THREE.Group | null,
        diceArray: [] as THREE.Mesh[],
        dyingDiceArray: [] as any[],
        currentDiceValues: [] as number[],
        isCupAnimating: false,
        dragProgress: 0,
        nextCyclicValue: 1,
        touchStartX: 0,
        touchStartY: 0,
        touchStartTime: 0,
        isInteracting: false,
        isDragging: false,
        currentCamPos: CAM_POS_FAR.clone(),
        currentLookAt: LOOK_AT_FAR.clone(),
        globalDiceGeometry: null as THREE.BufferGeometry | null,
        globalDiceMaterials: [] as THREE.Material[],
        envMap: null as THREE.Texture | null,
        tableTextTexture: null as THREE.CanvasTexture | null,
        hasTriggeredJackpot: false,
    });
    
    // Cheat handling
    const cheatRef = useRef({ count: 0, timer: null as any });

    const updateStatus = (text: string) => setStatusText(text);

    useEffect(() => {
        // --- Init Three.js ---
        const width = window.innerWidth;
        const height = window.innerHeight;
        const engine = engineRef.current;
        
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111111);
        scene.fog = new THREE.Fog(0x111111, 10, 50);
        engine.scene = scene;

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.copy(CAM_POS_FAR);
        camera.lookAt(LOOK_AT_FAR);
        engine.camera = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        if (mountRef.current) mountRef.current.appendChild(renderer.domElement);
        engine.renderer = renderer;

        // Environment
        const createStudioEnvMap = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 256; 
            const ctx = canvas.getContext('2d');
            if(!ctx) return null;
            ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, 512, 256);
            const grad = ctx.createLinearGradient(0, 0, 0, 128);
            grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#000000');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 80);
            ctx.fillStyle = '#444444'; ctx.fillRect(50, 100, 100, 50);
            ctx.fillStyle = '#333333'; ctx.fillRect(350, 120, 80, 40);
            const texture = new THREE.CanvasTexture(canvas);
            texture.mapping = THREE.EquirectangularReflectionMapping; 
            return texture;
        }
        engine.envMap = createStudioEnvMap();
        scene.environment = engine.envMap;

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(8, 15, 8); 
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048; dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.bias = -0.0001; 
        dirLight.shadow.camera.near = 0.5; dirLight.shadow.camera.far = 100; 
        dirLight.shadow.camera.left = -25; dirLight.shadow.camera.right = 25;
        dirLight.shadow.camera.top = 25; dirLight.shadow.camera.bottom = -25;
        scene.add(dirLight);
        const sideLight = new THREE.PointLight(0xffffff, 0.8, 50);
        sideLight.position.set(-10, 5, 10); scene.add(sideLight);
        const frontLight = new THREE.DirectionalLight(0xffffff, 0.6);
        frontLight.position.set(0, 5, 10); scene.add(frontLight);
        const fillLight = new THREE.DirectionalLight(0xeef0ff, 0.3);
        fillLight.position.set(-5, 8, -5); scene.add(fillLight);

        // Materials
        const createDiceTexture = (number: number) => {
            const canvas = document.createElement('canvas');
            const size = 1024; canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            if(!ctx) return null;
            ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = (number === 1 || number === 4) ? '#dd0000' : '#111111'; 
            let baseRadius = size / 11.6; if (number === 1) baseRadius *= 1.5;
            const drawDot = (x:number, y:number) => { ctx.beginPath(); ctx.arc(x, y, baseRadius, 0, Math.PI * 2); ctx.fill(); };
            const c = size / 2; const q = size / 4; const t = size * 3 / 4;
            if (number === 1) { drawDot(c, c); }
            else if (number === 2) { drawDot(q, q); drawDot(t, t); }
            else if (number === 3) { drawDot(q, q); drawDot(c, c); drawDot(t, t); }
            else if (number === 4) { drawDot(q, q); drawDot(t, q); drawDot(q, t); drawDot(t, t); }
            else if (number === 5) { drawDot(q, q); drawDot(t, q); drawDot(c, c); drawDot(q, t); drawDot(t, t); }
            else if (number === 6) { drawDot(q, q); drawDot(t, q); drawDot(q, c); drawDot(t, c); drawDot(q, t); drawDot(t, t); }
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            return texture;
        }

        const createDiceBumpMap = (number: number) => {
            const canvas = document.createElement('canvas');
            const size = 1024; canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            if(!ctx) return null;
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#000000'; ctx.shadowColor = '#000000'; ctx.shadowBlur = 20; 
            let baseRadius = size / 11.6; if (number === 1) baseRadius *= 1.5;
            const drawDot = (x:number, y:number) => { ctx.beginPath(); ctx.arc(x, y, baseRadius - 5, 0, Math.PI * 2); ctx.fill(); };
            const c = size / 2; const q = size / 4; const t = size * 3 / 4;
            if (number === 1) { drawDot(c, c); }
            else if (number === 2) { drawDot(q, q); drawDot(t, t); }
            else if (number === 3) { drawDot(q, q); drawDot(c, c); drawDot(t, t); }
            else if (number === 4) { drawDot(q, q); drawDot(t, q); drawDot(q, t); drawDot(t, t); }
            else if (number === 5) { drawDot(q, q); drawDot(t, q); drawDot(c, c); drawDot(q, t); drawDot(t, t); }
            else if (number === 6) { drawDot(q, q); drawDot(t, q); drawDot(q, c); drawDot(t, c); drawDot(q, t); drawDot(t, t); }
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            return texture;
        }

        engine.globalDiceGeometry = new RoundedBoxGeometry(DICE_SIZE, DICE_SIZE, DICE_SIZE, 6, DICE_RADIUS);
        engine.globalDiceMaterials = [];
        for (let i = 1; i <= 6; i++) {
            let num = i;
            if(i===1) num=1; else if(i===2) num=6; else if(i===3) num=2; else if(i===4) num=5; else if(i===5) num=3; else if(i===6) num=4;
            engine.globalDiceMaterials.push(new THREE.MeshStandardMaterial({ 
                map: createDiceTexture(num)!, bumpMap: createDiceBumpMap(num)!, bumpScale: 0.02, roughness: 0.2, metalness: 0.1 
            }));
        }

        // Floor
        const createFeltTexture = () => {
            const canvas = document.createElement('canvas');
            const size = 1024; canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            if(!ctx) return null;
            ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
            const imageData = ctx.getImageData(0, 0, size, size);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const noise = (Math.random() - 0.5) * 100; 
                let val = 128 + noise;
                if (val < 0) val = 0; if (val > 255) val = 255;
                data[i] = val; data[i+1] = val; data[i+2] = val; data[i+3] = 255;
            }
            ctx.putImageData(imageData, 0, 0);
            ctx.filter = 'blur(4px)'; ctx.drawImage(canvas, 0, 0); ctx.filter = 'none'; 
            const imageData2 = ctx.getImageData(0, 0, size, size);
            const data2 = imageData2.data;
            for (let i = 0; i < data2.length; i += 4) {
                const noise = (Math.random() - 0.5) * 20; 
                data2[i] += noise; data2[i+1] += noise; data2[i+2] += noise;
            }
            ctx.putImageData(imageData2, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(2, 2); 
            texture.minFilter = THREE.LinearMipmapLinearFilter; 
            return texture;
        }
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({ 
            color: 0x0a3d18, roughness: 0.9, metalness: 0.0,
            bumpMap: createFeltTexture(), bumpScale: 0.08, side: THREE.DoubleSide
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        // Table Text "Fa"
        const drawTableTextContent = (ctx: CanvasRenderingContext2D, size: number) => {
            const center = size / 2;
            ctx.clearRect(0, 0, size, size);
            const color = "#ffffff"; 
            ctx.strokeStyle = color; ctx.lineWidth = 30; 
            ctx.beginPath(); ctx.arc(center, center, 450, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 12; 
            // Fallback font stack
            ctx.font = "bold 650px 'Ma Shan Zheng', 'STKaiti', 'KaiTi', 'KaiTi_GB2312', 'FangSong', 'Microsoft YaHei', sans-serif"; 
            ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; 
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            const metrics = ctx.measureText("發");
            const ascent = metrics.actualBoundingBoxAscent; const descent = metrics.actualBoundingBoxDescent;
            const textX = center; const textY = center + (ascent - descent) / 2;
            ctx.strokeText("發", textX, textY); ctx.fillText("發", textX, textY);
            const imageData = ctx.getImageData(0, 0, size, size);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i+3];
                if (alpha > 0) {
                    const x = (i / 4) % size; const y = Math.floor((i / 4) / size);
                    const n = Perlin.noise(x * 0.2, y * 0.2, 5.5); 
                    if (alpha < 250) {
                        if (n < 0.2) data[i+3] = 0; else data[i+3] = 200; 
                    } else {
                        if (Math.random() > 0.98) data[i+3] = 50; 
                    }
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        const tableTextCanvas = document.createElement('canvas');
        tableTextCanvas.width = 1024; tableTextCanvas.height = 1024;
        const ttCtx = tableTextCanvas.getContext('2d');
        if(ttCtx) drawTableTextContent(ttCtx, 1024);
        engine.tableTextTexture = new THREE.CanvasTexture(tableTextCanvas);
        engine.tableTextTexture.minFilter = THREE.LinearMipmapLinearFilter;
        const textGeo = new THREE.PlaneGeometry(5.0, 5.0); 
        const textMat = new THREE.MeshBasicMaterial({ 
            map: engine.tableTextTexture, transparent: true, opacity: 0.3, 
            depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.05
        });
        const textMesh = new THREE.Mesh(textGeo, textMat);
        textMesh.rotation.x = -Math.PI / 2; textMesh.position.y = 0.015; 
        scene.add(textMesh);

        // Cup
        engine.cupMesh = new THREE.Group();
        const matBlack = new THREE.MeshPhysicalMaterial({ 
            color: 0x050505, roughness: 0.15, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.05, 
            envMap: engine.envMap, envMapIntensity: 1.5, side: THREE.DoubleSide
        });
        const matRed = new THREE.MeshPhysicalMaterial({
            color: 0xD40000, roughness: 0.25, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.05,
            envMap: engine.envMap, envMapIntensity: 1.2, side: THREE.DoubleSide
        });
        
        const outerPoints = [];
        const bevelSize = 0.05; const bevelBottom = 0.2; const cornerRadius = 0.6;
        outerPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - bevelSize, 0));
        const bottomCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(CUP_RADIUS_OPEN - bevelSize, 0), new THREE.Vector2(CUP_RADIUS_OPEN, 0), new THREE.Vector2(CUP_RADIUS_OPEN, bevelBottom));
        outerPoints.push(...bottomCurve.getPoints(12));
        const sideCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(CUP_RADIUS_OPEN, bevelBottom), new THREE.Vector2(CUP_RADIUS_TOP, CUP_HEIGHT * 0.6), new THREE.Vector2(CUP_RADIUS_TOP, CUP_HEIGHT - cornerRadius));
        outerPoints.push(...sideCurve.getPoints(32));
        const topCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(CUP_RADIUS_TOP, CUP_HEIGHT - cornerRadius), new THREE.Vector2(CUP_RADIUS_TOP, CUP_HEIGHT), new THREE.Vector2(CUP_RADIUS_TOP - cornerRadius, CUP_HEIGHT));
        outerPoints.push(...topCurve.getPoints(12));
        outerPoints.push(new THREE.Vector2(0.2, CUP_HEIGHT)); outerPoints.push(new THREE.Vector2(0, CUP_HEIGHT - 0.05)); 
        const outerGeo = new THREE.LatheGeometry(outerPoints, 64);
        const outerMesh = new THREE.Mesh(outerGeo, matBlack);
        outerMesh.castShadow = true; outerMesh.receiveShadow = true; engine.cupMesh.add(outerMesh);

        const innerPoints = [];
        const thickness = 0.25;
        innerPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - thickness - bevelSize, 0));
        const innerBottomCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(CUP_RADIUS_OPEN - thickness - bevelSize, 0), new THREE.Vector2(CUP_RADIUS_OPEN - thickness, 0), new THREE.Vector2(CUP_RADIUS_OPEN - thickness, bevelBottom));
        innerPoints.push(...innerBottomCurve.getPoints(12));
        const innerSideCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(CUP_RADIUS_OPEN - thickness, bevelBottom), new THREE.Vector2(CUP_RADIUS_TOP - thickness, CUP_HEIGHT * 0.6), new THREE.Vector2(CUP_RADIUS_TOP - thickness, CUP_HEIGHT - thickness - cornerRadius));
        innerPoints.push(...innerSideCurve.getPoints(32));
        const innerTopCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(CUP_RADIUS_TOP - thickness, CUP_HEIGHT - thickness - cornerRadius), new THREE.Vector2(CUP_RADIUS_TOP - thickness, CUP_HEIGHT - thickness), new THREE.Vector2(CUP_RADIUS_TOP - thickness - cornerRadius, CUP_HEIGHT - thickness));
        innerPoints.push(...innerTopCurve.getPoints(12));
        innerPoints.push(new THREE.Vector2(0, CUP_HEIGHT - thickness));
        const innerGeo = new THREE.LatheGeometry(innerPoints, 64);
        const innerMesh = new THREE.Mesh(innerGeo, matRed);
        innerMesh.receiveShadow = true; engine.cupMesh.add(innerMesh);

        const rimPoints = [];
        rimPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - thickness - bevelSize, 0));
        rimPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - bevelSize, 0));
        rimPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - bevelSize, 0.01));
        rimPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - thickness - bevelSize, 0.01));
        rimPoints.push(new THREE.Vector2(CUP_RADIUS_OPEN - thickness - bevelSize, 0));
        const rimGeo = new THREE.LatheGeometry(rimPoints, 64);
        const rimMesh = new THREE.Mesh(rimGeo, matBlack); 
        rimMesh.castShadow = true; rimMesh.receiveShadow = true; engine.cupMesh.add(rimMesh);

        engine.cupMesh.position.set(CUP_TARGET_CLOSED.y, CUP_TARGET_CLOSED.y, CUP_TARGET_CLOSED.z);
        scene.add(engine.cupMesh);

        // Resize handler
        const handleResize = () => {
            if(engine.camera && engine.renderer) {
                engine.camera.aspect = window.innerWidth / window.innerHeight;
                engine.camera.updateProjectionMatrix();
                engine.renderer.setSize(window.innerWidth, window.innerHeight);
            }
            if(LightRayManager.canvas) LightRayManager.resize();
        };
        window.addEventListener('resize', handleResize);

        // Animation Loop
        const animate = () => {
            requestAnimationFrame(animate);
            LightRayManager.animate();
            
            // Dice spawn animation
            engine.diceArray.forEach(dice => {
                if (dice.userData.targetScale && dice.scale.x < dice.userData.targetScale) {
                    dice.userData.spawnTime += 0.05;
                    dice.scale.setScalar(Math.min(dice.scale.x + 0.1, 1));
                }
            });
            // Dying dice animation
            for (let i = engine.dyingDiceArray.length - 1; i >= 0; i--) {
                const item = engine.dyingDiceArray[i];
                item.scale -= 0.1; 
                if (item.scale <= 0) {
                    if(engine.scene) engine.scene.remove(item.mesh);
                    item.mesh.geometry.dispose(); 
                    engine.dyingDiceArray.splice(i, 1);
                } else {
                    item.mesh.scale.setScalar(item.scale);
                }
            }
            
            if(engine.camera && engine.scene && engine.renderer) {
                engine.camera.lookAt(engine.currentLookAt);
                engine.renderer.render(engine.scene, engine.camera);
            }
        };
        animate();

        // Init LightRay
        if (confettiRef.current) LightRayManager.init(confettiRef.current);
        
        // Initial Dice
        resetDice(diceCount);

        return () => {
            window.removeEventListener('resize', handleResize);
            if(mountRef.current && engine.renderer) mountRef.current.removeChild(engine.renderer.domElement);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Helper Functions ---
    const getSafePosition = () => {
        const safeRadius = CUP_RADIUS_OPEN - 0.8;
        const minDistance = DICE_SIZE * 1.15;
        let position;
        let attempts = 0;
        const maxAttempts = 500;
        do {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * safeRadius;
            position = new THREE.Vector3(Math.cos(angle) * r, DICE_SIZE / 2, Math.sin(angle) * r);
            let collision = false;
            for (let die of engineRef.current.diceArray) {
                if (die.position.distanceTo(position) < minDistance) { collision = true; break; }
            }
            if (!collision) return position;
            attempts++;
        } while (attempts < maxAttempts);
        return position;
    };

    const addDie = (forcedValue: number | null = null) => {
        const engine = engineRef.current;
        if(!engine.globalDiceGeometry || !engine.scene) return;
        const dice = new THREE.Mesh(engine.globalDiceGeometry, engine.globalDiceMaterials);
        dice.castShadow = true; dice.receiveShadow = true;
        const pos = getSafePosition() || new THREE.Vector3(0, DICE_SIZE/2, 0);
        dice.position.copy(pos);
        
        const value = forcedValue !== null ? forcedValue : (Math.floor(Math.random() * 6) + 1);
        dice.rotation.set(0, 0, 0); 
        switch(value) {
            case 1: dice.rotateZ(Math.PI / 2); break;
            case 6: dice.rotateZ(-Math.PI / 2); break;
            case 2: break; 
            case 5: dice.rotateX(Math.PI); break;
            case 3: dice.rotateX(-Math.PI / 2); break;
            case 4: dice.rotateX(Math.PI / 2); break;
        }
        dice.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        dice.scale.set(0, 0, 0); dice.userData.targetScale = 1; dice.userData.spawnTime = 0;
        engine.diceArray.push(dice); engine.scene.add(dice);
    };

    const removeDie = () => {
        const engine = engineRef.current;
        if (engine.diceArray.length === 0) return;
        const dice = engine.diceArray.pop();
        if(dice) engine.dyingDiceArray.push({ mesh: dice, scale: 1.0 });
    };

    const resetDice = (count: number) => {
        const engine = engineRef.current;
        if(!engine.scene) return;
        engine.diceArray.forEach(d => engine.scene!.remove(d));
        engine.diceArray = [];
        engine.dyingDiceArray.forEach(d => engine.scene!.remove(d.mesh));
        engine.dyingDiceArray = [];
        for (let i = 0; i < count; i++) addDie();
        engine.diceArray.forEach(d => d.scale.set(1, 1, 1));
    };

    const updateDiceCount = (targetCount: number) => {
        const engine = engineRef.current;
        const diff = targetCount - engine.diceArray.length;
        if (diff > 0) { 
            for (let i = 0; i < diff; i++) {
                addDie(engine.nextCyclicValue);
                engine.nextCyclicValue = (engine.nextCyclicValue % 6) + 1;
            } 
        } 
        else if (diff < 0) { for (let i = 0; i < Math.abs(diff); i++) removeDie(); }
    };

    // --- Interaction Logic ---
    const updateSceneFromProgress = (progress: number) => {
        const engine = engineRef.current;
        if(!engine.cupMesh || !engine.camera) return;
        progress = Math.max(0, Math.min(1, progress));
        const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
        let rotProgress = progress * 1.5; if (rotProgress > 1) rotProgress = 1;
        const rotEase = 1 - Math.pow(1 - rotProgress, 3); 
        const posEase = ease;
        const tilt = Math.abs(CUP_TARGET_CLOSED.rotX + (CUP_TARGET_OPEN.rotX - CUP_TARGET_CLOSED.rotX) * rotEase);
        const sinkCorrection = Math.sin(tilt) * (CUP_RADIUS_OPEN * 0.9); 
        engine.cupMesh.position.y = (CUP_TARGET_CLOSED.y + (CUP_TARGET_OPEN.y - CUP_TARGET_CLOSED.y) * posEase) + sinkCorrection;
        engine.cupMesh.position.z = CUP_TARGET_CLOSED.z + (CUP_TARGET_OPEN.z - CUP_TARGET_CLOSED.z) * posEase;
        engine.cupMesh.rotation.x = CUP_TARGET_CLOSED.rotX + (CUP_TARGET_OPEN.rotX - CUP_TARGET_CLOSED.rotX) * rotEase;
        
        engine.currentCamPos.lerpVectors(CAM_POS_FAR, CAM_POS_CLOSE, ease);
        engine.currentLookAt.lerpVectors(LOOK_AT_FAR, LOOK_AT_CLOSE, ease);
        engine.camera.position.copy(engine.currentCamPos);
    };

    const finalizeDicePositions = () => {
        const engine = engineRef.current;
        const placedDice: THREE.Mesh[] = [];
        const minDistance = DICE_SIZE * 1.15; 
        engine.currentDiceValues = []; 

        let riggedValues: number[] | null = null;
        if (isCheatActive && engine.diceArray.length > 1) {
            riggedValues = [];
            const mainVal = Math.floor(Math.random() * 6) + 1;
            let uniqueVal = Math.floor(Math.random() * 6) + 1;
            while(uniqueVal === mainVal) { uniqueVal = Math.floor(Math.random() * 6) + 1; }
            for (let i = 0; i < engine.diceArray.length - 1; i++) { riggedValues.push(mainVal); }
            riggedValues.push(uniqueVal);
            riggedValues.sort(() => Math.random() - 0.5);
            setIsCheatActive(false);
        }

        engine.diceArray.forEach((dice, index) => {
            const value = riggedValues ? riggedValues[index] : (Math.floor(Math.random() * 6) + 1);
            engine.currentDiceValues.push(value);
            dice.rotation.set(0, 0, 0); 
            switch(value) {
                case 1: dice.rotateZ(Math.PI / 2); break;
                case 6: dice.rotateZ(-Math.PI / 2); break;
                case 2: break; 
                case 5: dice.rotateX(Math.PI); break;
                case 3: dice.rotateX(-Math.PI / 2); break;
                case 4: dice.rotateX(Math.PI / 2); break;
            }
            dice.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
            dice.position.y = DICE_SIZE / 2; 
            let position;
            let overlaps;
            let attempts = 0;
            const maxAttempts = 2000; 
            do {
                overlaps = false;
                const angle = Math.random() * Math.PI * 2;
                const safeRadius = CUP_RADIUS_OPEN - 0.8; 
                const r = Math.sqrt(Math.random()) * safeRadius;
                position = new THREE.Vector3(Math.cos(angle) * r, dice.position.y, Math.sin(angle) * r);
                for (const otherDice of placedDice) {
                    if (position.distanceTo(otherDice.position) < minDistance) { overlaps = true; break; }
                }
                attempts++;
            } while (overlaps && attempts < maxAttempts);
            if(position) dice.position.copy(position);
            placedDice.push(dice);
        });
    };

    const checkJackpot = () => {
        const engine = engineRef.current;
        if (engine.hasTriggeredJackpot) return;
        const totalDice = engine.diceArray.length;
        if (totalDice <= 3) return;
        let threshold = 0;
        if (totalDice === 8) threshold = 5;       
        else if (totalDice === 7) threshold = 4;  
        else if (totalDice === 6) threshold = 4;  
        else if (totalDice === 5) threshold = 3;  
        else if (totalDice === 4) threshold = 3;  
        if (threshold === 0) return;
        const counts: {[key: number]: number} = {};
        engine.currentDiceValues.forEach(val => { counts[val] = (counts[val] || 0) + 1; });
        let hasJackpot = false;
        for (let val in counts) { if (counts[val] >= threshold) { hasJackpot = true; break; } }
        if (hasJackpot) {
            LightRayManager.trigger();
            engine.hasTriggeredJackpot = true; 
        }
    };

    const shakeDice = useCallback(() => {
        const engine = engineRef.current;
        if (gameState !== GameState.IDLE) return;
        SoundManager.init();
        setGameState(GameState.SHAKING);
        updateStatus("摇动中...");
        engine.hasTriggeredJackpot = false;
        const startTime = Date.now();
        let lastShakeTime = 0; 
        
        const loop = () => {
            const currentGS = gameState; // Closure issue, better check engine state or manage externally?
            // Since we set state, we rely on ref values or assume loop runs to completion
            
            const elapsed = Date.now() - startTime;
            if (elapsed < SHAKE_DURATION) {
                const t = elapsed * 0.025; 
                let damping = 1.0;
                const fadeOutTime = 250;
                if (elapsed > SHAKE_DURATION - fadeOutTime) {
                    const remaining = SHAKE_DURATION - elapsed;
                    damping = Math.pow(remaining / fadeOutTime, 2); 
                }
                const swingX = Math.sin(t * 1.2) * 0.6 * damping;
                const baseLift = 0.8 * damping; 
                const bobY = Math.abs(Math.sin(t * 1.2)) * 0.4 * damping; 
                const noiseX = (Math.random() - 0.5) * 0.08 * damping;
                const noiseY = (Math.random() - 0.5) * 0.08 * damping;
                const noiseZ = (Math.random() - 0.5) * 0.08 * damping;

                if(engine.cupMesh) {
                    engine.cupMesh.position.x = swingX + noiseX;
                    engine.cupMesh.position.y = CUP_TARGET_CLOSED.y + baseLift + bobY + noiseY; 
                    engine.cupMesh.position.z = CUP_TARGET_CLOSED.z + noiseZ;
                    engine.cupMesh.rotation.z = -swingX * 0.35; 
                    engine.cupMesh.rotation.x = (Math.random() - 0.5) * 0.1 * damping;
                    engine.cupMesh.rotation.y = (Math.random() - 0.5) * 0.05 * damping;
                }

                if (damping > 0.2 && elapsed - lastShakeTime > 100) {
                    if (Math.random() > 0.3) { SoundManager.playShake(); lastShakeTime = elapsed; }
                }

                engine.diceArray.forEach(dice => {
                    dice.rotation.x += Math.random() * 0.5 * damping;
                    dice.rotation.y += Math.random() * 0.5 * damping;
                    const range = CUP_RADIUS_OPEN * 0.4 * damping; 
                    if(engine.cupMesh) {
                        dice.position.x = engine.cupMesh.position.x + (Math.random() - 0.5) * range;
                        dice.position.z = engine.cupMesh.position.z + (Math.random() - 0.5) * range;
                    }
                    dice.position.y = DICE_SIZE / 2 + (Math.random() * 2.0 + 0.5) * damping; 
                });
                requestAnimationFrame(loop);
            } else {
                finalizeDicePositions();
                if(engine.cupMesh) {
                    engine.cupMesh.position.set(0, CUP_TARGET_CLOSED.y, CUP_TARGET_CLOSED.z);
                    engine.cupMesh.rotation.set(0,0,0);
                }
                updateSceneFromProgress(0); 
                engine.dragProgress = 0;
                setGameState(GameState.IDLE);
                updateStatus("向上滑动打开");
            }
        };
        loop();
    }, [gameState]);

    const snapAnimation = useCallback((targetProgress: number) => {
        const engine = engineRef.current;
        if (engine.isCupAnimating) return;
        engine.isCupAnimating = true;
        
        const startProgress = engine.dragProgress;
        let animProgress = 0;
        const speed = (targetProgress === 1) ? 0.06 : 0.035;

        const loop = () => {
            animProgress += speed; 
            if (animProgress >= 1) {
                engine.dragProgress = targetProgress;
                updateSceneFromProgress(targetProgress);
                engine.isCupAnimating = false;
                
                if (targetProgress === 1) {
                    // We check global state or DOM state. 
                    // To simplify, we rely on the passed target.
                    // If we are in settings mode, we don't go to OPENED.
                    // But `snapAnimation` is usually called from main view.
                    // We will set to OPENED.
                    setGameState(prev => {
                        if (prev === GameState.SETTINGS) return prev;
                        updateStatus("向下拖动盖上");
                        checkJackpot();
                        SoundManager.playOpen();
                        return GameState.OPENED;
                    });
                } else {
                    if (startProgress > 0.1) SoundManager.playClose();
                    setGameState(prev => {
                         if (prev === GameState.SETTINGS) return prev; // If closing from settings, handled elsewhere?
                         updateStatus("点击骰盅摇骰子");
                         return GameState.IDLE;
                    });
                }
            } else {
                let ease;
                if (targetProgress === 1) ease = 1 - Math.pow(1 - animProgress, 2); 
                else ease = 1 - Math.pow(1 - animProgress, 3);
                const currentP = startProgress + (targetProgress - startProgress) * ease;
                updateSceneFromProgress(currentP);
                engine.dragProgress = currentP;
                requestAnimationFrame(loop);
            }
        }
        loop();
    }, []);

    const onInputStart = useCallback((e: any) => {
        SoundManager.init();
        if (e.target.closest('button') || e.target.closest('.control-group')) return;
        if (gameState === GameState.SETTINGS) return;
        if (engineRef.current.isCupAnimating || gameState === GameState.SHAKING) return;
        if (e.touches && e.touches.length > 1) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        engineRef.current.touchStartX = clientX; 
        engineRef.current.touchStartY = clientY; 
        engineRef.current.touchStartTime = Date.now();
        engineRef.current.isInteracting = true; 
        engineRef.current.isDragging = false;
    }, [gameState]);

    const onInputMove = useCallback((e: any) => {
        const engine = engineRef.current;
        if (gameState === GameState.SETTINGS) return;
        if (!engine.isInteracting) return; 
        if (engine.isCupAnimating || gameState === GameState.SHAKING) return;
        // e.preventDefault(); // React synthetic events? Native better for passive: false
        let clientY;
        if (e.changedTouches) { if (e.changedTouches.length === 0) return; clientY = e.changedTouches[0].clientY; } else { clientY = e.clientY; }
        const diffY = clientY - engine.touchStartY;
        if (!engine.isDragging && Math.abs(diffY) > TAP_THRESHOLD) engine.isDragging = true;
        if (engine.isDragging) {
            let deltaProgress = -diffY / DRAG_FULL_DISTANCE;
            let baseProgress = (gameState === GameState.IDLE) ? 0 : 1;
            engine.dragProgress = baseProgress + deltaProgress;
            updateSceneFromProgress(engine.dragProgress);
        }
    }, [gameState]);

    const onInputEnd = useCallback((e: any) => {
        const engine = engineRef.current;
        if (gameState === GameState.SETTINGS) return;
        if (!engine.isInteracting) return;
        engine.isInteracting = false; 
        if (engine.isCupAnimating || gameState === GameState.SHAKING) return;
        if (!engine.isDragging) {
            const timeDiff = Date.now() - engine.touchStartTime;
            if (timeDiff < 500) {
                // Check click
                let clientX, clientY;
                if (e.changedTouches) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; } else { clientX = e.clientX; clientY = e.clientY; }
                if (gameState === GameState.IDLE) {
                    const mouse = new THREE.Vector2();
                    mouse.x = (clientX / window.innerWidth) * 2 - 1;
                    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
                    const raycaster = new THREE.Raycaster();
                    raycaster.setFromCamera(mouse, engine.camera!);
                    const intersects = raycaster.intersectObjects([engine.cupMesh!], true);
                    if (intersects.length > 0) shakeDice();
                }
            }
            return;
        }
        engine.isDragging = false;
        if (gameState === GameState.IDLE) {
            if (engine.dragProgress > 0.3) snapAnimation(1); else snapAnimation(0); 
        } else { 
            if (engine.dragProgress < 0.7) snapAnimation(0); else snapAnimation(1); 
        }
    }, [gameState, shakeDice, snapAnimation]);

    // Attach listeners
    useEffect(() => {
        const canvas = mountRef.current;
        if(!canvas) return;
        // Native events for passive: false
        const tStart = (e: any) => onInputStart(e);
        const tMove = (e: any) => { e.preventDefault(); onInputMove(e); };
        const tEnd = (e: any) => onInputEnd(e);
        const mStart = (e: any) => onInputStart(e);
        const mMove = (e: any) => onInputMove(e);
        const mEnd = (e: any) => onInputEnd(e);

        canvas.addEventListener('touchstart', tStart, { passive: false });
        canvas.addEventListener('touchmove', tMove, { passive: false });
        canvas.addEventListener('touchend', tEnd, { passive: false });
        canvas.addEventListener('mousedown', mStart);
        window.addEventListener('mousemove', mMove);
        window.addEventListener('mouseup', mEnd);

        return () => {
            canvas.removeEventListener('touchstart', tStart);
            canvas.removeEventListener('touchmove', tMove);
            canvas.removeEventListener('touchend', tEnd);
            canvas.removeEventListener('mousedown', mStart);
            window.removeEventListener('mousemove', mMove);
            window.removeEventListener('mouseup', mEnd);
        }
    }, [onInputStart, onInputMove, onInputEnd]);

    const enterSettings = () => {
        if (gameState !== GameState.IDLE && gameState !== GameState.OPENED) return;
        setGameState(GameState.SETTINGS);
        
        const engine = engineRef.current;
        if (engine.dragProgress < 0.99) {
            SoundManager.playOpen();
            snapAnimation(1); 
        } else {
            engine.dragProgress = 1;
            updateSceneFromProgress(1);
        }
    };

    const confirmSettings = () => {
        snapAnimation(0);
        setGameState(GameState.IDLE);
        updateStatus("点击骰盅摇骰子");
    };

    const adjustDiceCount = (delta: number) => {
        let newCount = diceCount + delta;
        if (newCount < 1) newCount = 1;
        if (newCount > 8) newCount = 8;
        if (newCount !== diceCount) {
            if (delta > 0) SoundManager.playUI('add'); else SoundManager.playUI('remove');
            setDiceCount(newCount);
            updateDiceCount(newCount);
        }
    };

    const handleCheatClick = () => {
        const c = cheatRef.current;
        clearTimeout(c.timer);
        c.count++;
        c.timer = setTimeout(() => { c.count = 0; }, 1500);
        if (c.count === 10) setIsCheatActive(true);
        else if (c.count > 10 && isCheatActive) setIsCheatActive(false);
    };

    return (
        <>
            <div id="canvas-container" ref={mountRef}></div>
            <canvas id="confetti-canvas" ref={confettiRef}></canvas>
            
            <div id="ui-layer">
                <div class="footer-bar">
                    <div className={`game-panel ${gameState === GameState.SETTINGS ? 'hidden' : ''}`}>
                        <button className="settings-btn" onClick={enterSettings}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </button>
                        <div 
                            className="instruction glass-panel" 
                            onClick={handleCheatClick} 
                            // @ts-ignore
                            onMouseDown={handleCheatClick}
                        >
                            <span>{statusText}</span>
                        </div>
                    </div>

                    <div className={`settings-panel ${gameState === GameState.SETTINGS ? 'show' : ''}`}>
                        <div className="control-group glass-panel">
                            <button className="btn-icon" onClick={() => adjustDiceCount(-1)}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                            <span id="setting-dice-count">{diceCount}</span>
                            <button className="btn-icon" onClick={() => adjustDiceCount(1)}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                        </div>
                        <button className="btn-check" onClick={confirmSettings}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
