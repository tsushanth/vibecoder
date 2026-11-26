package com.kreativekoala.vibecoder.ui.browse

import android.content.Context
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.AuthUser
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.di.AppModule
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/** "Remix" is only offered on other people's apps, and a refused remix says why. */
@OptIn(ExperimentalCoroutinesApi::class)
class ProjectPreviewViewModelTest {
    private val context = mockk<Context>(relaxed = true)
    private val projects = mockk<ProjectRepository>(relaxed = true)
    private val auth = mockk<AuthRepository>(relaxed = true)

    @Before fun setUp() {
        Dispatchers.setMain(StandardTestDispatcher())
        every { auth.currentUser } returns AuthUser("u1", "a@b.c", "Ann", null)
        every { context.getString(R.string.err_fork_failed, *anyVararg()) } answers {
            "Fork failed: " + secondArg<Array<Any>>().first()
        }
    }

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.open(creator: String): ProjectPreviewViewModel {
        coEvery { projects.getProject("p1") } returns Project(id = "p1", title = "T", creatorId = creator)
        val vm = ProjectPreviewViewModel(context, projects, auth)
        vm.loadProject("p1")
        advanceUntilIdle()
        return vm
    }

    @Test fun ownApp_cannotBeRemixed() = runTest {
        val vm = open(creator = "u1")
        assertFalse(vm.uiState.value.canRemix)
        vm.forkProject()
        advanceUntilIdle()
        coVerify(exactly = 0) { projects.forkProject(any(), any(), any(), any()) }
    }

    @Test fun refusedRemix_showsTheServersSentence() = runTest {
        coEvery { projects.forkProject(any(), any(), any(), any()) } throws
            HttpException(Response.error<Any>(400, """{"error":"Project has no bundle to fork"}""".toResponseBody()))
        val vm = open(creator = "someone-else")
        assertTrue(vm.uiState.value.canRemix)
        vm.forkProject()
        advanceUntilIdle()
        assertEquals("Fork failed: Project has no bundle to fork", vm.uiState.value.errorMessage)
    }

    @Test fun singleProjectResponse_carriesTheCreator() {
        val project = AppModule.provideGson().fromJson("""{"id":"p1","title":"T","creatorId":"u1"}""", Project::class.java)
        assertEquals("u1", project.creatorId)
    }
}
