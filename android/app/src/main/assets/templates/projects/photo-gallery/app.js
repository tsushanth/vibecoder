class PhotoGallery {
    constructor() {
        this.photos = [];
        this.albums = ['All Photos'];
        this.currentAlbum = 'all';
        this.currentPhotoIndex = 0;
        this.filteredPhotos = [];

        this.init();
    }

    init() {
        this.loadData();
        this.setupEventListeners();
        this.renderAlbumTabs();
        this.renderGallery();
    }

    loadData() {
        const savedPhotos = localStorage.getItem('photoGallery_photos');
        const savedAlbums = localStorage.getItem('photoGallery_albums');

        if (savedPhotos) {
            this.photos = JSON.parse(savedPhotos);
        }

        if (savedAlbums) {
            this.albums = JSON.parse(savedAlbums);
        }
    }

    saveData() {
        localStorage.setItem('photoGallery_photos', JSON.stringify(this.photos));
        localStorage.setItem('photoGallery_albums', JSON.stringify(this.albums));
    }

    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const manageAlbumsBtn = document.getElementById('manageAlbumsBtn');
        const lightboxClose = document.getElementById('lightboxClose');
        const lightboxPrev = document.getElementById('lightboxPrev');
        const lightboxNext = document.getElementById('lightboxNext');
        const deletePhotoBtn = document.getElementById('deletePhotoBtn');
        const changeAlbumBtn = document.getElementById('changeAlbumBtn');
        const createAlbumBtn = document.getElementById('createAlbumBtn');
        const closeAlbumModal = document.getElementById('closeAlbumModal');
        const closeSelectAlbumModal = document.getElementById('closeSelectAlbumModal');
        const newAlbumInput = document.getElementById('newAlbumInput');

        uploadZone.addEventListener('click', () => fileInput.click());
        uploadBtn.addEventListener('click', () => fileInput.click());

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
            this.handleFiles(files);
        });

        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            this.handleFiles(files);
            fileInput.value = '';
        });

        manageAlbumsBtn.addEventListener('click', () => this.openAlbumModal());
        closeAlbumModal.addEventListener('click', () => this.closeAlbumModal());
        closeSelectAlbumModal.addEventListener('click', () => this.closeSelectAlbumModal());

        createAlbumBtn.addEventListener('click', () => this.createAlbum());
        newAlbumInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createAlbum();
        });

        lightboxClose.addEventListener('click', () => this.closeLightbox());
        lightboxPrev.addEventListener('click', () => this.navigateLightbox(-1));
        lightboxNext.addEventListener('click', () => this.navigateLightbox(1));
        deletePhotoBtn.addEventListener('click', () => this.deleteCurrentPhoto());
        changeAlbumBtn.addEventListener('click', () => this.openSelectAlbumModal());

        document.getElementById('lightbox').addEventListener('click', (e) => {
            if (e.target.id === 'lightbox' || e.target.classList.contains('lightbox-overlay')) {
                this.closeLightbox();
            }
        });

        document.getElementById('albumModal').addEventListener('click', (e) => {
            if (e.target.id === 'albumModal' || e.target.classList.contains('modal-overlay')) {
                this.closeAlbumModal();
            }
        });

        document.getElementById('selectAlbumModal').addEventListener('click', (e) => {
            if (e.target.id === 'selectAlbumModal' || e.target.classList.contains('modal-overlay')) {
                this.closeSelectAlbumModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            const lightbox = document.getElementById('lightbox');
            if (lightbox.classList.contains('active')) {
                if (e.key === 'Escape') this.closeLightbox();
                if (e.key === 'ArrowLeft') this.navigateLightbox(-1);
                if (e.key === 'ArrowRight') this.navigateLightbox(1);
            }
        });
    }

    handleFiles(files) {
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const photo = {
                    id: Date.now() + Math.random(),
                    data: e.target.result,
                    album: this.currentAlbum === 'all' ? 'All Photos' : this.currentAlbum,
                    timestamp: Date.now()
                };
                this.photos.push(photo);
                this.saveData();
                this.renderGallery();
            };
            reader.readAsDataURL(file);
        });
    }

    renderAlbumTabs() {
        const albumsBar = document.getElementById('albumsBar');
        albumsBar.innerHTML = '';

        const allTab = document.createElement('button');
        allTab.className = 'album-tab' + (this.currentAlbum === 'all' ? ' active' : '');
        allTab.textContent = 'All Photos';
        allTab.dataset.album = 'all';
        allTab.addEventListener('click', () => this.switchAlbum('all'));
        albumsBar.appendChild(allTab);

        this.albums.forEach(album => {
            if (album !== 'All Photos') {
                const tab = document.createElement('button');
                tab.className = 'album-tab' + (this.currentAlbum === album ? ' active' : '');
                tab.textContent = album;
                tab.dataset.album = album;
                tab.addEventListener('click', () => this.switchAlbum(album));
                albumsBar.appendChild(tab);
            }
        });
    }

    switchAlbum(album) {
        this.currentAlbum = album;
        this.renderAlbumTabs();
        this.renderGallery();
    }

    getFilteredPhotos() {
        if (this.currentAlbum === 'all') {
            return this.photos;
        }
        return this.photos.filter(photo => photo.album === this.currentAlbum);
    }

    renderGallery() {
        const gallery = document.getElementById('gallery');
        const emptyState = document.getElementById('emptyState');

        this.filteredPhotos = this.getFilteredPhotos();

        if (this.filteredPhotos.length === 0) {
            gallery.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        gallery.innerHTML = '';

        this.filteredPhotos.forEach((photo, index) => {
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item';
            photoItem.style.animationDelay = `${index * 0.05}s`;

            const img = document.createElement('img');
            img.src = photo.data;
            img.alt = 'Photo';

            const overlay = document.createElement('div');
            overlay.className = 'photo-overlay';

            const albumLabel = document.createElement('div');
            albumLabel.className = 'photo-album';
            albumLabel.textContent = photo.album;

            overlay.appendChild(albumLabel);
            photoItem.appendChild(img);
            photoItem.appendChild(overlay);

            photoItem.addEventListener('click', () => this.openLightbox(index));

            gallery.appendChild(photoItem);
        });
    }

    openLightbox(index) {
        this.currentPhotoIndex = index;
        const lightbox = document.getElementById('lightbox');
        const lightboxImage = document.getElementById('lightboxImage');
        const lightboxAlbum = document.getElementById('lightboxAlbum');

        const photo = this.filteredPhotos[index];
        lightboxImage.src = photo.data;
        lightboxAlbum.textContent = `Album: ${photo.album}`;

        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeLightbox() {
        const lightbox = document.getElementById('lightbox');
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    navigateLightbox(direction) {
        this.currentPhotoIndex += direction;

        if (this.currentPhotoIndex < 0) {
            this.currentPhotoIndex = this.filteredPhotos.length - 1;
        } else if (this.currentPhotoIndex >= this.filteredPhotos.length) {
            this.currentPhotoIndex = 0;
        }

        const photo = this.filteredPhotos[this.currentPhotoIndex];
        const lightboxImage = document.getElementById('lightboxImage');
        const lightboxAlbum = document.getElementById('lightboxAlbum');

        lightboxImage.style.animation = 'none';
        setTimeout(() => {
            lightboxImage.src = photo.data;
            lightboxAlbum.textContent = `Album: ${photo.album}`;
            lightboxImage.style.animation = 'zoomIn 0.3s ease-out';
        }, 50);
    }

    deleteCurrentPhoto() {
        if (confirm('Are you sure you want to delete this photo?')) {
            const photo = this.filteredPhotos[this.currentPhotoIndex];
            const photoIndexInAll = this.photos.findIndex(p => p.id === photo.id);

            if (photoIndexInAll !== -1) {
                this.photos.splice(photoIndexInAll, 1);
                this.saveData();
                this.closeLightbox();
                this.renderGallery();
            }
        }
    }

    openSelectAlbumModal() {
        const modal = document.getElementById('selectAlbumModal');
        const albumsSelect = document.getElementById('albumsSelect');
        albumsSelect.innerHTML = '';

        this.albums.forEach(album => {
            const option = document.createElement('div');
            option.className = 'album-option';
            option.textContent = album;
            option.addEventListener('click', () => this.changePhotoAlbum(album));
            albumsSelect.appendChild(option);
        });

        modal.classList.add('active');
    }

    closeSelectAlbumModal() {
        const modal = document.getElementById('selectAlbumModal');
        modal.classList.remove('active');
    }

    changePhotoAlbum(newAlbum) {
        const photo = this.filteredPhotos[this.currentPhotoIndex];
        const photoIndexInAll = this.photos.findIndex(p => p.id === photo.id);

        if (photoIndexInAll !== -1) {
            this.photos[photoIndexInAll].album = newAlbum;
            this.saveData();
            this.closeSelectAlbumModal();

            const lightboxAlbum = document.getElementById('lightboxAlbum');
            lightboxAlbum.textContent = `Album: ${newAlbum}`;

            setTimeout(() => {
                this.closeLightbox();
                this.renderGallery();
            }, 300);
        }
    }

    openAlbumModal() {
        const modal = document.getElementById('albumModal');
        this.renderAlbumsList();
        modal.classList.add('active');
    }

    closeAlbumModal() {
        const modal = document.getElementById('albumModal');
        modal.classList.remove('active');
        document.getElementById('newAlbumInput').value = '';
    }

    renderAlbumsList() {
        const albumsList = document.getElementById('albumsList');
        albumsList.innerHTML = '';

        this.albums.forEach(album => {
            const albumItem = document.createElement('div');
            albumItem.className = 'album-item';

            const albumInfo = document.createElement('div');

            const albumName = document.createElement('span');
            albumName.className = 'album-name';
            albumName.textContent = album;

            const albumCount = document.createElement('span');
            albumCount.className = 'album-count';
            const count = this.photos.filter(p => p.album === album).length;
            albumCount.textContent = `(${count})`;

            albumInfo.appendChild(albumName);
            albumInfo.appendChild(albumCount);
            albumItem.appendChild(albumInfo);

            if (album !== 'All Photos') {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'album-delete';
                deleteBtn.innerHTML = '🗑️';
                deleteBtn.addEventListener('click', () => this.deleteAlbum(album));
                albumItem.appendChild(deleteBtn);
            }

            albumsList.appendChild(albumItem);
        });
    }

    createAlbum() {
        const input = document.getElementById('newAlbumInput');
        const albumName = input.value.trim();

        if (!albumName) {
            alert('Please enter an album name');
            return;
        }

        if (this.albums.includes(albumName)) {
            alert('Album already exists');
            return;
        }

        this.albums.push(albumName);
        this.saveData();
        input.value = '';
        this.renderAlbumsList();
        this.renderAlbumTabs();
    }

    deleteAlbum(albumName) {
        if (confirm(`Are you sure you want to delete the album "${albumName}"?\n\nPhotos will be moved to "All Photos".`)) {
            this.albums = this.albums.filter(a => a !== albumName);

            this.photos.forEach(photo => {
                if (photo.album === albumName) {
                    photo.album = 'All Photos';
                }
            });

            if (this.currentAlbum === albumName) {
                this.currentAlbum = 'all';
            }

            this.saveData();
            this.renderAlbumsList();
            this.renderAlbumTabs();
            this.renderGallery();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PhotoGallery();
});
