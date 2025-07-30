import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  console.log('Webhook received! Using Document AI architecture.');

  const { record: newDocument } = req.body;
  if (!newDocument?.id) {
    return res.status(400).send('Document ID is missing');
  }

  const documentId = newDocument.id;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log(`Starting analysis for document: ${documentId}`);

    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id')
      .eq('id', documentId)
      .single();
    if (docError) throw docError;

    await supabase.from('document_uploads')
      .update({ analysis_status: 'analyzing' })
      .eq('id', documentId);

    console.log('Downloading file from Supabase Storage...');
    const { data: fileData, error: downloadError } = await supabase
      .storage.from('documents')
      .download(document.storage_path);
    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const base64 = buffer.toString('base64');

    const docAIClient = new DocumentProcessorServiceClient();
    const name = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/processors/${process.env.GCP_PROCESSOR_ID}`;
    const request = {
      name,
      rawDocument: {
        content: base64,
        mimeType: 'application/pdf',
      },
    };

    const [result] = await docAIClient.processDocument(request);
    const { text } = result.document;
    if (!text) throw new Error('Document AI did not extract any text.');

    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12 ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.`,
          },
          {
            role: 'user',
            content: `Analise este documento financeiro de condomínio:\n\n${text}`,
          },
        ],
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    let analysisText = openaiResponse.data.choices[0].message.content;
    let jsonString = analysisText;
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonString = jsonMatch[0];
    const financialData = JSON.parse(jsonString);

    await supabase.from('financial_analysis').insert({
      condominium_id: document.condominium_id,
      document_upload_id: document.id,
      ...financialData,
    });

    await supabase.from('document_uploads').update({
      analysis_status: 'completed',
      analyzed_at: new Date().toISOString(),
    }).eq('id', documentId);

    console.log('Analysis completed successfully.');
    return res.status(200).json({ success: true, message: 'Analysis completed successfully' });

  } catch (error) {
    console.error('Analysis error:', error.response?.data || error.stack || error.message);
    await supabase.from('document_uploads')
      .update({ analysis_status: 'failed' })
      .eq('id', documentId);

    return res.status(500).json({ success: false, error: error.message });
  }
}
