import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCSV } from '../src/parser.js';
import { processBatch } from '../src/groqService.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log("==================================================");
  console.log("🧪 GROW EASY AI CRM INGESTION ENGINE TESTS");
  console.log("==================================================\n");
  
  // Test Case 1: CSV Parser Unit Test
  try {
    console.log("👉 Test 1: Testing CSV Parser with Facebook Lead Export...");
    const filePath = path.join(__dirname, '../../test-data/facebook_leads.csv');
    const buffer = fs.readFileSync(filePath);
    const records = parseCSV(buffer);
    
    console.log(`   Found columns: ${Object.keys(records[0]).join(', ')}`);
    console.log(`   Total parsed rows: ${records.length}`);
    
    if (records.length === 2) {
      console.log("   ✅ Parser check passed: correctly parsed 2 records.\n");
    } else {
      throw new Error(`Expected 2 records, got ${records.length}`);
    }
  } catch (err) {
    console.error("   ❌ Parser check failed:", err.message, "\n");
  }

  // Test Case 2: AI Mapping (Requires API Key)
  if (!process.env.GROQ_API_KEY) {
    console.log("⚠️ Skipping AI Mapping tests because GROQ_API_KEY is not defined in the environment.");
    console.log("   Set GROQ_API_KEY inside backend/.env to verify LLM mapping.\n");
    return;
  }
  
  console.log("👉 Test 2: Testing Groq AI Ingestion on Messy CSV Columns...");
  try {
    const filePath = path.join(__dirname, '../../test-data/messy_leads.csv');
    const buffer = fs.readFileSync(filePath);
    const records = parseCSV(buffer);
    
    console.log("   Sending messy leads to Groq API...");
    const result = await processBatch(records, 1);
    
    console.log("\n   --- Mapped Output ---");
    console.log(JSON.stringify(result, null, 2));
    console.log("   ---------------------\n");
    
    if (result.imported && result.imported.length > 0) {
      console.log("   ✅ AI Mapping successfully extracted lead fields!");
      
      const lead = result.imported[0];
      
      // Verify crm_status mapping
      const validStatuses = ["GOOD_LEAD_FOLLOW_UP", "DID_NOT_CONNECT", "BAD_LEAD", "SALE_DONE"];
      if (validStatuses.includes(lead.crm_status)) {
        console.log(`   ✅ CRM Status field successfully mapped to: "${lead.crm_status}"`);
      } else {
        console.error(`   ❌ CRM Status validation failed: value "${lead.crm_status}" is invalid.`);
      }
      
      // Verify data_source mapping
      const validSources = ["leads_on_demand", "meridian_tower", "eden_park", "varah_swamy", "sarjapur_plots", ""];
      if (validSources.includes(lead.data_source)) {
        console.log(`   ✅ Data Source field successfully mapped to: "${lead.data_source || 'empty'}"`);
      } else {
        console.error(`   ❌ Data Source validation failed: value "${lead.data_source}" is invalid.`);
      }
      
      // Verify multiple emails check
      if (lead.crm_note && lead.crm_note.includes("rajesh.work@example.com")) {
        console.log("   ✅ Multiple emails handled: secondary emails moved to notes.");
      }
      
      // Verify multiple mobile numbers check
      if (lead.crm_note && lead.crm_note.includes("+91 9876543219")) {
        console.log("   ✅ Multiple phone numbers handled: secondary numbers moved to notes.");
      }
    } else {
      throw new Error("No leads returned in the 'imported' array.");
    }
  } catch (err) {
    console.error("   ❌ AI Ingestion check failed:", err.message);
  }
}

runTests();
