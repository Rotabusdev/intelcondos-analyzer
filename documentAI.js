import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

const docAIClient = new DocumentProcessorServiceClient();

export async function extractTextFromPdfBuffer(buffer, processorConfig) {
  const base64 = buffer.toString('base64');
  const name = `projects/${processorConfig.projectId}/locations/${processorConfig.location}/processors/${processorConfig.processorId}`;

  const request = {
    name,
    rawDocument: {
      content: base64,
      mimeType: 'application/pdf',
    },
  };

  const [result] = await docAIClient.processDocument(request);

  if (!result?.document?.text) {
    throw new Error('Nenhum texto extraído do documento.');
  }

  return result.document.text;
}
