// ===================================================================
// DoubleX GameStudio - Common Scripts
// ===================================================================

(function() {
    'use strict';

    // ===================================================================
    // 0. DOM Ready - Wait for elements to exist
    // ===================================================================
    function init() {
        initBackToTop();
        initParticleBackground();
        initCustomCursor();
        initMobileMenu();
        initNavbarScroll();
        initScrollReveal();
        initSmoothScroll();
    }

    // ===================================================================
    // 1. 回到顶部按钮
    // ===================================================================
    function initBackToTop() {
        const backToTop = document.getElementById('backToTop');
        if (!backToTop) return;

        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        });

        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ===================================================================
    // 2. 粒子背景系统
    // ===================================================================
    function initParticleBackground() {
        const canvas = document.getElementById('particle-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let particles = [];
        let mouse = { x: null, y: null, radius: 150 };

        /* 按设备像素比放大画布后备存储：高分屏下粒子边缘才不糊。
           CSS 尺寸由样式表控制，这里只调分辨率。 */
        let viewW = window.innerWidth, viewH = window.innerHeight;

        function resizeCanvas() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            viewW = window.innerWidth;
            viewH = window.innerHeight;
            canvas.width = Math.round(viewW * dpr);
            canvas.height = Math.round(viewH * dpr);
            // ctx 已按 dpr 缩放，因此后续所有绘制与坐标都用逻辑像素（viewW/viewH）
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        class Particle {
            constructor() {
                this.reset();
            }

            reset() {
                this.x = Math.random() * viewW;
                this.y = Math.random() * viewH;
                this.size = Math.random() * 2 + 0.5;
                this.baseSize = this.size;
                this.speedX = (Math.random() - 0.5) * 0.5;
                this.speedY = (Math.random() - 0.5) * 0.5;
                this.opacity = Math.random() * 0.5 + 0.1;
            }

            /* dt = 距上一帧的时间，以 60Hz 的一帧（16.667ms）为 1。
               位移必须乘 dt，否则速度会随设备刷新率变化：
               120Hz 设备上粒子会跑两倍快。 */
            update(dt) {
                this.x += this.speedX * dt;
                this.y += this.speedY * dt;

                if (mouse.x !== null) {
                    const dx = this.x - mouse.x;
                    const dy = this.y - mouse.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < mouse.radius) {
                        const force = (mouse.radius - dist) / mouse.radius;
                        const dirX = dx / dist;
                        const dirY = dy / dist;
                        this.x += dirX * force * 3 * dt;
                        this.y += dirY * force * 3 * dt;
                    }
                }

                if (this.x < 0 || this.x > viewW ||
                    this.y < 0 || this.y > viewH) {
                    this.reset();
                }
            }

            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
                ctx.fill();
            }
        }

        function initParticles() {
            const count = Math.min(Math.floor((viewW * viewH) / 8000), 150);
            particles = [];
            for (let i = 0; i < count; i++) {
                particles.push(new Particle());
            }
        }

        initParticles();

        // Handle resize with particle reinit
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeCanvas();
                initParticles();
            }, 200);
        });

        function drawConnections() {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = 120;

                    if (dist < maxDist) {
                        const opacity = (1 - dist / maxDist) * 0.2;
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
        }

        // 以 60Hz 一帧为基准单位；上限 50ms 防止切后台回来时粒子瞬移
        const FRAME_MS = 1000 / 60;
        const MAX_DT_MS = 50;
        let lastFrameTs = 0;

        function animateParticles(ts) {
            if (!lastFrameTs) lastFrameTs = ts || 0;
            const elapsed = (ts || 0) - lastFrameTs;
            lastFrameTs = ts || 0;
            const dt = Math.min(elapsed, MAX_DT_MS) / FRAME_MS;

            ctx.clearRect(0, 0, viewW, viewH);

            particles.forEach(p => {
                p.update(dt);
                p.draw();
            });

            drawConnections();
            requestAnimationFrame(animateParticles);
        }

        animateParticles();

        document.addEventListener('mousemove', (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });

        document.addEventListener('mouseleave', () => {
            mouse.x = null;
            mouse.y = null;
        });
    }

    // ===================================================================
    // 3. 自定义光标
    // ===================================================================
    function initCustomCursor() {
        const cursorDot = document.getElementById('cursorDot');
        const cursorRing = document.getElementById('cursorRing');
        if (!cursorDot || !cursorRing) return;

        let ringX = 0, ringY = 0;
        let mouseX = 0, mouseY = 0;

        const IDLE_MS = 5000;      // 无操作 5 秒后淡出
        const FADE_MS = 500;       // 淡入淡出时长，与 CSS 保持一致
        let appeared = false;      // 是否已经拿到过真实鼠标位置
        let idleTimer = null;

        function setIdle(on) {
            if (on) { cursorDot.classList.add('is-visible'); cursorRing.classList.add('is-visible'); }
            else { cursorDot.classList.remove('is-visible'); cursorRing.classList.remove('is-visible'); }
        }

        function scheduleIdleFade() {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => setIdle(false), IDLE_MS);
        }

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;

            if (!appeared) {
                /* 首次拿到真实位置：先把圆环瞬移到鼠标处再淡入，
                   否则它会从 (0,0) 左上角一路飞过来 */
                appeared = true;
                ringX = mouseX;
                ringY = mouseY;
            }

            cursorDot.style.left = mouseX + 'px';
            cursorDot.style.top = mouseY + 'px';

            setIdle(true);
            scheduleIdleFade();
        });

        /* 帧率无关的缓动：原先每帧固定收敛 0.35，高刷屏上会明显更"黏"。
           k = 1 - (1 - 0.35)^dt，dt 以 60Hz 一帧为单位。 */
        let lastCursorTs = 0;
        function animateCursor(ts) {
            if (!lastCursorTs) lastCursorTs = ts || 0;
            const elapsed = (ts || 0) - lastCursorTs;
            lastCursorTs = ts || 0;
            const dt = Math.min(elapsed, 50) / (1000 / 60);
            const k = 1 - Math.pow(1 - 0.35, dt);
            ringX += (mouseX - ringX) * k;
            ringY += (mouseY - ringY) * k;
            cursorRing.style.left = ringX + 'px';
            cursorRing.style.top = ringY + 'px';
            requestAnimationFrame(animateCursor);
        }

        animateCursor();

        /* 悬停放大改用事件委派：
           原先在加载时用 querySelectorAll 逐个绑定，而画廊卡片、详情页按钮
           （查看大图 / 游戏详情等）都是随后由 loader 异步注入的 —— 那时绑定
           早已执行完毕，这些元素因此永远拿不到 .active。
           委派到 document 后，静态与动态元素一律生效。 */
        /* 可交互元素选择器：悬停时放大光标环。
           用裸标签 a / button 覆盖全部链接与按钮 —— 包括 loader 异步注入的
           游戏详情、查看大图、团队卡等，因此无需再逐个类名列举。 */
        const HOVER_SEL = 'a, button, .project-card, .team-card-link, .team-card, '
            + '.contact-link, .stat-item, .gallery-item, .feature-card, .btn, .nav-link';

        document.addEventListener('mouseover', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest(HOVER_SEL)) { cursorRing.classList.add('active'); }
        });

        document.addEventListener('mouseout', (e) => {
            const t = e.target;
            if (!t || !t.closest) { return; }
            const from = t.closest(HOVER_SEL);
            if (!from) { return; }
            const to = e.relatedTarget;
            // 仍在同一个可交互元素内部移动时不移除，避免子元素间抖动
            if (to && to.closest && to.closest(HOVER_SEL) === from) { return; }
            cursorRing.classList.remove('active');
        });

        document.addEventListener('click', (e) => {
            const ripple = document.createElement('div');
            ripple.className = 'cursor-ripple';
            ripple.style.left = e.clientX + 'px';
            ripple.style.top = e.clientY + 'px';
            document.body.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });

        if ('ontouchstart' in window) {
            cursorDot.style.display = 'none';
            cursorRing.style.display = 'none';
        }
    }

    // ===================================================================
    // 4. 移动端菜单
    // ===================================================================
    function initMobileMenu() {
        const menuToggle = document.getElementById('menuToggle');
        const navLinks = document.getElementById('navLinks');
        if (!menuToggle || !navLinks) return;

        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('active');
            navLinks.classList.toggle('active');
        });

        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                menuToggle.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }

    // ===================================================================
    // 5. 导航栏滚动效果
    // ===================================================================
    function initNavbarScroll() {
        const navbar = document.getElementById('navbar');
        if (!navbar) return;

        window.addEventListener('scroll', () => {
            if (window.scrollY > 100) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }

    // ===================================================================
    // 6. 滚动动画 (Intersection Observer)
    // ===================================================================
    function initScrollReveal() {
        const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-up, .reveal-scale');

        if (!revealElements.length) return;

        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, observerOptions);

        revealElements.forEach(el => observer.observe(el));
    }

    // ===================================================================
    // 7. 平滑滚动 (兼容锚点)
    // ===================================================================
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href === '#') return;
                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    const offsetTop = target.offsetTop - 70;
                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    // ===================================================================
    // 启动
    // ===================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();