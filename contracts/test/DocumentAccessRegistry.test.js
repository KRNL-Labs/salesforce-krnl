const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DocumentAccessRegistry", function () {
  let registry;
  let admin, manager, officer, user, integration;

  beforeEach(async function () {
    [admin, manager, officer, user, integration] = await ethers.getSigners();

    const DocumentAccessRegistry = await ethers.getContractFactory("DocumentAccessRegistry");
    registry = await DocumentAccessRegistry.deploy(admin.address);
    await registry.waitForDeployment();

    // Grant roles
    const DOCUMENT_MANAGER_ROLE = await registry.DOCUMENT_MANAGER_ROLE();
    const COMPLIANCE_OFFICER_ROLE = await registry.COMPLIANCE_OFFICER_ROLE();

    await registry.connect(admin).grantRole(DOCUMENT_MANAGER_ROLE, manager.address);
    await registry.connect(admin).grantRole(COMPLIANCE_OFFICER_ROLE, officer.address);
  });

  describe("Document Registration", function () {
    it("Should register a new document", async function () {
      const documentHash = "0x1234567890abcdef";
      const salesforceId = "SF001";
      const metadata = '{"type":"contract","size":1024}';

      await registry.connect(manager).registerDocument(documentHash, salesforceId, metadata);

      const doc = await registry.getDocument(documentHash);
      expect(doc.documentHash).to.equal(documentHash);
      expect(doc.salesforceRecordId).to.equal(salesforceId);
      expect(doc.registeredBy).to.equal(manager.address);
      expect(doc.isActive).to.be.true;
    });

    it("Should fail to register duplicate document", async function () {
      const documentHash = "0x1234567890abcdef";
      const salesforceId = "SF001";
      const metadata = '{"type":"contract"}';

      await registry.connect(manager).registerDocument(documentHash, salesforceId, metadata);

      await expect(
        registry.connect(manager).registerDocument(documentHash, salesforceId, metadata)
      ).to.be.revertedWith("Document already registered");
    });

    it("Should fail if not document manager", async function () {
      await expect(
        registry.connect(user).registerDocument("0x123", "SF001", "{}")
      ).to.be.reverted;
    });
  });

  describe("Access Logging", function () {
    beforeEach(async function () {
      await registry.connect(manager).registerDocument("0x123", "SF001", "{}");
      await registry.connect(officer).setSalesforceIntegrationAuth(integration.address, true);
    });

    it("Should log document access", async function () {
      await registry.connect(integration).logDocumentAccess(
        "0x123",
        "USER001",
        "view",
        "192.168.1.1",
        "Mozilla/5.0"
      );

      const logs = await registry.getDocumentAccessLogs("0x123");
      expect(logs.length).to.equal(1);
      expect(logs[0].salesforceUserId).to.equal("USER001");
      expect(logs[0].accessType).to.equal("view");
    });

    it("Should fail for non-existent document", async function () {
      await expect(
        registry.connect(integration).logDocumentAccess("0x999", "USER001", "view", "IP", "UA")
      ).to.be.revertedWith("Document not registered");
    });

    it("Should fail for unauthorized caller", async function () {
      await expect(
        registry.connect(user).logDocumentAccess("0x123", "USER001", "view", "IP", "UA")
      ).to.be.revertedWith("Unauthorized to log access");
    });
  });

  describe("Document Management", function () {
    beforeEach(async function () {
      await registry.connect(manager).registerDocument("0x123", "SF001", "{}");
    });

    it("Should deactivate document", async function () {
      await registry.connect(manager).deactivateDocument("0x123");

      const doc = await registry.getDocument("0x123");
      expect(doc.isActive).to.be.false;
    });

    it("Should fail to log access to deactivated document", async function () {
      await registry.connect(officer).setSalesforceIntegrationAuth(integration.address, true);
      await registry.connect(manager).deactivateDocument("0x123");

      await expect(
        registry.connect(integration).logDocumentAccess("0x123", "USER001", "view", "IP", "UA")
      ).to.be.revertedWith("Document is not active");
    });
  });

  describe("Integration Authorization", function () {
    it("Should authorize Salesforce integration", async function () {
      await registry.connect(officer).setSalesforceIntegrationAuth(integration.address, true);

      expect(await registry.authorizedSalesforceIntegrations(integration.address)).to.be.true;
    });

    it("Should revoke integration authorization", async function () {
      await registry.connect(officer).setSalesforceIntegrationAuth(integration.address, true);
      await registry.connect(officer).setSalesforceIntegrationAuth(integration.address, false);

      expect(await registry.authorizedSalesforceIntegrations(integration.address)).to.be.false;
    });

    it("Should fail if not compliance officer", async function () {
      await expect(
        registry.connect(user).setSalesforceIntegrationAuth(integration.address, true)
      ).to.be.reverted;
    });
  });

  describe("Emergency Controls", function () {
    it("Should pause and unpause contract", async function () {
      await registry.connect(admin).pause();

      await expect(
        registry.connect(manager).registerDocument("0x123", "SF001", "{}")
      ).to.be.revertedWith("Pausable: paused");

      await registry.connect(admin).unpause();

      await registry.connect(manager).registerDocument("0x123", "SF001", "{}");
      const doc = await registry.getDocument("0x123");
      expect(doc.isActive).to.be.true;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await registry.connect(manager).registerDocument("0x123", "SF001", "{}");
      await registry.connect(manager).registerDocument("0x456", "SF002", "{}");
    });

    it("Should return document count", async function () {
      expect(await registry.getDocumentCount()).to.equal(2);
    });

    it("Should return document hash by index", async function () {
      expect(await registry.getDocumentHashByIndex(0)).to.equal("0x123");
      expect(await registry.getDocumentHashByIndex(1)).to.equal("0x456");
    });

    it("Should check document existence", async function () {
      expect(await registry.documentExists("0x123")).to.be.true;
      expect(await registry.documentExists("0x999")).to.be.false;
    });
  });
});