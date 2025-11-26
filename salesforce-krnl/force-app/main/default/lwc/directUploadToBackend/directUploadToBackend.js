import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import initDirectUpload from '@salesforce/apex/DocumentAccessLogger.initDirectUpload';
import getViewerUrl from '@salesforce/apex/DocumentAccessLogger.getViewerUrl';
import recordDirectUploadMetadata from '@salesforce/apex/DocumentAccessLogger.recordDirectUploadMetadata';

export default class DirectUploadToBackend extends LightningElement {
    @api recordId;

    @track file;
    @track fileName;
    @track isUploading = false;
    @track hash;
    @track storagePath;
    @track storageBucket;
    @track uploadRecordId;

    handleFileChange(event) {
        const files = event.target.files;
        if (files && files.length > 0) {
            this.file = files[0];
            this.fileName = this.file.name;
            this.hash = null;
            this.storagePath = null;
        } else {
            this.file = null;
            this.fileName = null;
        }
    }

    async handleUpload() {
        if (!this.file) {
            this.showToast('Error', 'Please select a file before uploading', 'error');
            return;
        }

        if (!this.recordId) {
            this.showToast('Error', 'Component must be placed on a record page with a recordId', 'error');
            return;
        }

        this.isUploading = true;
        try {
            const uploadUrl = await initDirectUpload({ recordId: this.recordId });

            if (!uploadUrl) {
                throw new Error('Backend did not return an upload URL');
            }

            const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    // The backend expects application/octet-stream so that express.raw parses the body as a Buffer
                    'Content-Type': 'application/octet-stream',
                    'X-File-Name': this.file.name
                },
                body: this.file
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upload failed (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            this.hash = data && data.hash ? data.hash : null;
            this.storageBucket = data && data.storage ? data.storage.bucket : null;
            this.storagePath = data && data.storage ? data.storage.path : null;

            // Persist upload metadata in Salesforce so we can show a per-record upload list later
            if (this.recordId && this.hash) {
                try {
                    const docId = await recordDirectUploadMetadata({
                        recordId: this.recordId,
                        hash: this.hash,
                        storageBucket: this.storageBucket,
                        storagePath: this.storagePath,
                        fileName: this.fileName
                    });
                    this.uploadRecordId = docId;
                } catch (metaError) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to record upload metadata', metaError);
                    // Non-fatal: upload+hash still succeeded, just metadata recording failed
                }
            }

            this.showToast('Success', 'File uploaded to backend and hashed successfully', 'success');

            // Notify parent component to refresh its lists
            this.dispatchEvent(new CustomEvent('uploadsuccess', {
                detail: {
                    recordId: this.recordId,
                    hash: this.hash,
                    fileName: this.fileName,
                    uploadRecordId: this.uploadRecordId
                }
            }));
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Direct upload failed', error);
            this.showToast('Error', error.message || 'Direct upload failed', 'error');
        } finally {
            this.isUploading = false;
        }
    }

    async handleView() {
        if (!this.storagePath) {
            this.showToast('Error', 'No storage path available for this upload', 'error');
            return;
        }

        if (!this.recordId) {
            this.showToast('Error', 'Component must be placed on a record page with a recordId', 'error');
            return;
        }

        try {
            const url = await getViewerUrl({ recordId: this.recordId, path: this.storagePath });

            if (!url) {
                throw new Error('Backend did not return a viewer URL');
            }

            // Open the signed URL in a new browser tab for viewing/downloading
            // eslint-disable-next-line no-undef
            window.open(url, '_blank');
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to get viewer URL', error);
            this.showToast('Error', error.message || 'Failed to open document', 'error');
        }
    }

    get truncatedHash() {
        if (!this.hash) {
            return '';
        }

        const value = String(this.hash);
        if (value.length <= 24) {
            return value;
        }

        const prefix = value.slice(0, 10);
        const suffix = value.slice(-8);
        return `${prefix}...${suffix}`;
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title,
            message,
            variant
        });
        this.dispatchEvent(evt);
    }
}
