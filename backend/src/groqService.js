import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GROQ_API_KEY is not set in the environment variables.");
}

const groq = new Groq({
  apiKey: apiKey || 'placeholder_key',
});

// Using Llama-3-70b for high accuracy and reasoning capability on mappings
const DEFAULT_MODEL = 'llama3-70b-8192';

/**
 * Process a batch of raw records through Groq LLM
 * @param {Array<Object>} records - Raw CSV rows (mapped as JS objects)
 * @param {number} batchIndex - Index of current batch for logging
 * @returns {Promise<Object>} Object containing "imported" and "skipped" arrays
 */
export async function processBatch(records, batchIndex) {
  const systemPrompt = `You are an expert AI Lead CRM Ingestion assistant. Your task is to map and parse raw, unstructured/differently structured CRM lead records from a CSV file into the target CRM format.

Target CRM Fields Schema:
- created_at: Lead creation date. It MUST be in a format convertible using JavaScript's \`new Date(created_at)\` (e.g. "YYYY-MM-DD HH:MM:SS" or ISO 8601 string). If the source date is missing or invalid, generate a current timestamp or default to the current date.
- name: Lead name. If first name and last name are in separate columns, combine them.
- email: Primary email. If multiple email addresses are found in the record, use the first one, and append any additional ones to 'crm_note'.
- country_code: Country code (e.g. "+91", "+1").
- mobile_without_country_code: Mobile number without country code. If multiple numbers exist, use the first one, and append any additional ones to 'crm_note'.
- company: Company name.
- city: City.
- state: State.
- country: Country.
- lead_owner: Lead owner email or identifier.
- crm_status: Strict allowed values: "GOOD_LEAD_FOLLOW_UP", "DID_NOT_CONNECT", "BAD_LEAD", "SALE_DONE". Map any incoming status fields, notes, or descriptions of status to one of these values. If none fits or is missing, use "GOOD_LEAD_FOLLOW_UP" as default.
- crm_note: General notes, remarks, follow-up notes, additional comments, extra phone numbers, extra email addresses, or any other useful info that doesn't fit in other fields.
- data_source: Strict allowed values: "leads_on_demand", "meridian_tower", "eden_park", "varah_swamy", "sarjapur_plots". If none matches confidently, leave it empty (do not guess).
- possession_time: Property possession time.
- description: Additional description.

CRITICAL SKIP RULE:
- If a record has NEITHER a valid email address nor a valid mobile number, it MUST be skipped. Put it in the "skipped" array with a brief reason.

Output Format:
You must output a JSON object containing two arrays: "imported" and "skipped".
Example output:
{
  "imported": [
    {
      "original_index": 0,
      "created_at": "2026-05-13 14:20:48",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "country_code": "+91",
      "mobile_without_country_code": "9876543210",
      "company": "GrowEasy",
      "city": "Mumbai",
      "state": "Maharashtra",
      "country": "India",
      "lead_owner": "test@gmail.com",
      "crm_status": "GOOD_LEAD_FOLLOW_UP",
      "crm_note": "Client is asking to reschedule demo",
      "data_source": "leads_on_demand",
      "possession_time": "",
      "description": ""
    }
  ],
  "skipped": [
    {
      "original_index": 1,
      "reason": "Neither email nor mobile number found in this record."
    }
  ]
}

Ensure all imported records strictly conform to the keys and rules. Do not include markdown code block formatting (like \`\`\`json) in your raw response, return only the raw JSON.`;

  const userPrompt = `Here is the batch of raw records to process (Batch index: ${batchIndex}):
${JSON.stringify(records.map((r, i) => ({ original_index: i, ...r })), null, 2)}

Process all records. Return the output in the specified JSON schema.`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: process.env.GROQ_MODEL || DEFAULT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.1, // Low temperature for higher accuracy and consistency
    });

    const resultText = chatCompletion.choices[0].message.content;
    return JSON.parse(resultText);
  } catch (error) {
    console.error(`Error processing batch ${batchIndex} with Groq:`, error);
    throw error;
  }
}
