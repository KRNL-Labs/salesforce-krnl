## KRNL Secure Document Manager for Salesforce

Secure document uploads, personalized watermarking, and authenticity verification—right inside Salesforce.

This Salesforce app—developed by KRNL Labs and powered by the KRNL Protocol—provides a secure and verifiable way to upload, share, and view sensitive documents directly inside Salesforce. Every viewer automatically receives a personalized, identity-bound watermark, ensuring full accountability and discouraging leaks, screenshots, or content theft. Even if a document is captured or exported, the watermark remains tied to the viewer's identity.

Users interact with the app through a Salesforce Lightning component that can be added to any record page, such as Accounts, Contacts, Opportunities, or custom objects. This component provides a simple interface for uploading documents, viewing their registration status, and accessing previously submitted files—all directly within Salesforce. No special setup, configuration, or technical knowledge is required; the app works seamlessly through the familiar Salesforce interface.

Behind the scenes, the app uses the KRNL Protocol to generate a blockchain-anchored digital fingerprint for every uploaded document. This fingerprint acts as a permanent proof of authenticity, ensuring that the document has not been altered or replaced. A secure backend service—fully managed by KRNL Labs—handles hashing, on-chain anchoring, identity resolution, and authenticity verification while ensuring that documents are always delivered through a controlled, auditable path.

Document access never bypasses this protected delivery pipeline. When a viewer opens a document, the system confirms their Salesforce identity and applies a real-time watermark unique to that individual. All access events—uploads, views, registrations, and authenticity checks—are logged and remain fully auditable within Salesforce. This workflow fits naturally into existing Salesforce processes while adding strong security, compliance, and traceability.

## Key capabilities

- **Blockchain-anchored integrity**  
  Each upload is hashed and anchored via the KRNL Protocol, providing immutable verification and tamper detection.

- **Lightning-based upload & delivery**  
  Users upload and access documents through a Salesforce Lightning component placed directly on record pages. Documents never leave the secure processing path, supporting enterprise compliance requirements.

- **Identity-bound watermarking**  
  Every viewer receives a dynamic watermark tied to their Salesforce identity.

- **Leak prevention by design**  
  Screenshots, recordings, or shared copies always contain traceable identifiers.

- **Authenticity enforcement**  
  Any modification to a document invalidates its fingerprint, ensuring reliable verification at any time.

- **Full auditability inside Salesforce**  
  Admins can see who uploaded each document, who viewed it, and when—along with registration and verification events.

## How it works

1. **Upload**  
   Users upload documents directly from the KRNL component on a Salesforce record page. A cryptographic fingerprint is generated and anchored on-chain.

2. **View**  
   When a file is opened, the system identifies the viewer and applies a personalized watermark.

3. **Prevent leaks**  
   Any screenshot or recording includes the viewer's watermark.

4. **Verify authenticity**  
   The KRNL Protocol can confirm whether the document matches its original fingerprint.

5. **Track access**  
   Admins can review upload history, viewing activity, and verification results—directly in Salesforce.