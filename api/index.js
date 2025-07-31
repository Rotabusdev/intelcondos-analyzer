// Versão de Produção Final
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  const { record: newDocument } = req.body;
  if (!newDocument || !newDocument.id) {
    return res.status(400).send('Document ID is missing');
  }
  const documentId = newDocument.id;

  // Usando a URL fixa que sabemos que funciona
  const supabaseUrl = 'https://tlukxqnwrdxprwyedvlz.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log(`Starting analysis for document: ${documentId}`);

    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id, file_type')
      .eq('id', documentId)
      .single();
    if (docError) throw docError;

    await supabase.from('document_uploads').update({ analysis_status: 'analyzing' }).eq('id', documentId);

    console.log('Downloading file from Supabase Storage...');
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(document.storage_path);
    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const base64 = buffer.toString('base64');

    console.log('Extracting text with Google Document AI...');
    const docAIClient = new DocumentProcessorServiceClient();
    const name = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/processors/${process.env.GCP_PROCESSOR_ID}`;
    const request = {
      name: name,
      rawDocument: {
        content: base64,
        mimeType: document.file_type || 'application/pdf',
      },
    };
    const [result] = await docAIClient.processDocument(request);
    const { text } = result.document;

    if (!text) {
      throw new Error('Document AI did not extract any text.');
    }

    console.log(`Text extracted! Length: ${text.length}. Analyzing with OpenAI...`);
    const openaiResponse = await axios.post(/* ... sua lógica da OpenAI ... */);
    const analysisText = openaiResponse.data.choices[0].message.content;

    let jsonString = analysisText;
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonString = jsonMatch[0];
    }
    const financialData = JSON.parse(jsonString);

    console.log('Creating financial data record...');
    await supabase.from('financial_analysis').insert({
      condominium_id: document.condominium_id,
      document_upload_id: document.id,
      ...financialData
    });

    await supabase.from('document_uploads').update({
      analysis_status: 'completed',
      analyzed_at: new Date().toISOString()
    }).eq('id', documentId);

    console.log('Analysis completed successfully');
    res.status(200).send({ success: true, message: 'Analysis completed successfully' });

  } catch (error) {
    console.error("Analysis error:", error.response?.data || error.stack || error.message);
    await supabase.from("document_uploads").update({ analysis_status: "failed" }).eq("id", documentId);
    res.status(500).send({ success: false, error: error.message });
  }
});

module.exports = app;