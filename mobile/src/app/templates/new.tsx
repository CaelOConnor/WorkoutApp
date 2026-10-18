import { useRouter } from 'expo-router';
import { useState } from 'react';

import { TemplateEditor } from '@/components/template-editor';
import { createTemplateForm } from '@/workouts/template-form';
import { useCreateTemplate } from '@/workouts/use-templates';

// "+ New template" on the Templates tab: an empty form, saved with POST /templates.
// Only reachable while signed in.
export default function NewTemplateScreen() {
  const router = useRouter();
  const createTemplate = useCreateTemplate();
  // Built once: the editor compares against it to know whether anything was entered.
  const [initial] = useState(createTemplateForm);

  return (
    <TemplateEditor
      initial={initial}
      save={(body) => createTemplate.mutateAsync(body)}
      saving={createTemplate.isPending}
      // replace, not push: back from the new template goes to the list, not to this form.
      onSaved={(template) =>
        router.replace({ pathname: '/templates/[id]', params: { id: String(template.id) } })
      }
    />
  );
}
